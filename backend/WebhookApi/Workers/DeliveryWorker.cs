using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WebhookApi.Data;
using WebhookApi.Models;
using WebhookApi.Services;

namespace WebhookApi.Workers;

public class DeliveryWorker : BackgroundService
{
    private const int MaxAttempts = 5;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly DeliveryScheduler _scheduler;
    private readonly SubscriptionCache _subscriptionCache;
    private readonly ILogger<DeliveryWorker> _logger;

    public DeliveryWorker(
        IServiceScopeFactory scopeFactory,
        IHttpClientFactory httpClientFactory,
        DeliveryScheduler scheduler,
        SubscriptionCache subscriptionCache,
        ILogger<DeliveryWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _httpClientFactory = httpClientFactory;
        _scheduler = scheduler;
        _subscriptionCache = subscriptionCache;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Delivery worker started.");
        await SeedScheduleFromDatabaseAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                await FanOutNewEventsAsync(db, stoppingToken);
                await ProcessDueDeliveriesAsync(db, stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in delivery worker cycle.");
            }

            await Task.Delay(PollInterval, stoppingToken);
        }
    }

    // SAFETY NET: rebuild the Redis schedule from Postgres on startup.
    // If Redis was lost, every Pending delivery still in the DB gets re-scheduled.
    private async Task SeedScheduleFromDatabaseAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var pending = await db.Deliveries
            .Where(d => d.Status == DeliveryStatus.Pending)
            .ToListAsync(ct);

        foreach (var d in pending)
            await _scheduler.ScheduleAsync(d.Id, d.NextAttemptAt);

        if (pending.Count > 0)
            _logger.LogInformation("Seeded {Count} pending deliveries into Redis.", pending.Count);
    }

    // Turn each new event into one Delivery per matching subscriber,
    // then SCHEDULE each delivery in Redis (instead of waiting for a poll).
    private async Task FanOutNewEventsAsync(AppDbContext db, CancellationToken ct)
    {
        var newEvents = await db.Events
            .Where(e => e.ProcessedAt == null)
            .ToListAsync(ct);

        foreach (var ev in newEvents)
        {
            var subscriberIds = await _subscriptionCache
                .GetActiveSubscriptionIdsAsync(ev.EventType, db, ct);

            foreach (var subId in subscriberIds)
            {
                var delivery = new Delivery
                {
                    Id = Guid.NewGuid(),
                    EventId = ev.Id,
                    SubscriptionId = subId,
                    Status = DeliveryStatus.Pending,
                    AttemptCount = 0,
                    NextAttemptAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                };
                db.Deliveries.Add(delivery);
                await _scheduler.ScheduleAsync(delivery.Id, delivery.NextAttemptAt);
            }

            ev.ProcessedAt = DateTime.UtcNow;
        }

        if (newEvents.Count > 0)
            await db.SaveChangesAsync(ct);
    }

    // Ask REDIS which deliveries are due, then load and process those rows from Postgres.
    private async Task ProcessDueDeliveriesAsync(AppDbContext db, CancellationToken ct)
    {
        var dueIds = await _scheduler.GetDueAsync(50);
        if (dueIds.Count == 0)
            return;

        foreach (var id in dueIds)
        {
            var delivery = await db.Deliveries.FindAsync(new object[] { id }, ct);

            // If it's gone or already finished, just drop it from the set.
            if (delivery is null || delivery.Status != DeliveryStatus.Pending)
            {
                await _scheduler.RemoveAsync(id);
                continue;
            }

            var ev = await db.Events.FindAsync(new object[] { delivery.EventId }, ct);
            var sub = await db.Subscriptions.FindAsync(new object[] { delivery.SubscriptionId }, ct);

            if (ev is null || sub is null)
            {
                delivery.Status = DeliveryStatus.DeadLettered;
                delivery.CompletedAt = DateTime.UtcNow;
                await _scheduler.RemoveAsync(id);
                continue;
            }

            delivery.AttemptCount++;
            var (success, attempt) = await AttemptDeliveryAsync(ev, sub, delivery.AttemptCount, ct);
            db.DeliveryAttempts.Add(attempt);

            if (success)
            {
                delivery.Status = DeliveryStatus.Delivered;
                delivery.CompletedAt = DateTime.UtcNow;
                await _scheduler.RemoveAsync(id);
                _logger.LogInformation("Delivery {Id} succeeded on attempt {N}.", id, delivery.AttemptCount);
            }
            else if (delivery.AttemptCount >= MaxAttempts)
            {
                delivery.Status = DeliveryStatus.DeadLettered;
                delivery.CompletedAt = DateTime.UtcNow;
                await _scheduler.RemoveAsync(id);
                _logger.LogWarning("Delivery {Id} dead-lettered after {N} attempts.", id, delivery.AttemptCount);
            }
            else
            {
                var delay = TimeSpan.FromSeconds(Math.Pow(2, delivery.AttemptCount));
                delivery.NextAttemptAt = DateTime.UtcNow.Add(delay);
                await _scheduler.ScheduleAsync(id, delivery.NextAttemptAt); // reschedule = re-add with new score
                _logger.LogInformation("Delivery {Id} failed attempt {N}, retrying in {Delay}s.",
                    id, delivery.AttemptCount, delay.TotalSeconds);
            }
        }

        await db.SaveChangesAsync(ct);
    }

    private async Task<(bool success, DeliveryAttempt attempt)> AttemptDeliveryAsync(
        Event ev, Subscription sub, int attemptNumber, CancellationToken ct)
    {
        var attempt = new DeliveryAttempt
        {
            Id = Guid.NewGuid(),
            EventId = ev.Id,
            SubscriptionId = sub.Id,
            AttemptNumber = attemptNumber,
            AttemptedAt = DateTime.UtcNow
        };

        var payload = JsonSerializer.Serialize(new
        {
            eventId = ev.Id,
            eventType = ev.EventType,
            payload = ev.Payload,
            timestamp = ev.CreatedAt
        });

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(10);

        var stopwatch = Stopwatch.StartNew();
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Post, sub.Url)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            var signature = ComputeSignature(payload, sub.Secret);
            request.Headers.Add("X-Signature", $"sha256={signature}");

            var response = await client.SendAsync(request, ct);
            stopwatch.Stop();

            var body = await response.Content.ReadAsStringAsync(ct);
            attempt.StatusCode = (int)response.StatusCode;
            attempt.Success = response.IsSuccessStatusCode;
            attempt.ResponseBody = body.Length > 1000 ? body[..1000] : body;
            attempt.DurationMs = (int)stopwatch.ElapsedMilliseconds;
            return (attempt.Success, attempt);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            attempt.Success = false;
            attempt.ErrorMessage = ex.Message;
            attempt.DurationMs = (int)stopwatch.ElapsedMilliseconds;
            return (false, attempt);
        }
    }

    private static string ComputeSignature(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}