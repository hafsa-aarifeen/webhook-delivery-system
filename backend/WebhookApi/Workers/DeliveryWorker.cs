using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WebhookApi.Data;
using WebhookApi.Models;
using System.Security.Cryptography;

namespace WebhookApi.Workers;

public class DeliveryWorker : BackgroundService
{
    private const int MaxAttempts = 5;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(2);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<DeliveryWorker> _logger;

    public DeliveryWorker(
        IServiceScopeFactory scopeFactory,
        IHttpClientFactory httpClientFactory,
        ILogger<DeliveryWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Delivery worker started.");

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

    // 1. Turn each new event into one Delivery per matching subscriber.
    private async Task FanOutNewEventsAsync(AppDbContext db, CancellationToken ct)
    {
        var newEvents = await db.Events
            .Where(e => e.ProcessedAt == null)
            .ToListAsync(ct);

        foreach (var ev in newEvents)
        {
            var subscribers = await db.Subscriptions
                .Where(s => s.IsActive && s.EventType == ev.EventType)
                .ToListAsync(ct);

            foreach (var sub in subscribers)
            {
                db.Deliveries.Add(new Delivery
                {
                    Id = Guid.NewGuid(),
                    EventId = ev.Id,
                    SubscriptionId = sub.Id,
                    Status = DeliveryStatus.Pending,
                    AttemptCount = 0,
                    NextAttemptAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                });
            }

            ev.ProcessedAt = DateTime.UtcNow; // "fanned out", not "delivered"
        }

        if (newEvents.Count > 0)
            await db.SaveChangesAsync(ct);
    }

    // 2. Attempt every delivery that's due; retry with backoff or dead-letter.
    private async Task ProcessDueDeliveriesAsync(AppDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var due = await db.Deliveries
            .Where(d => d.Status == DeliveryStatus.Pending && d.NextAttemptAt <= now)
            .ToListAsync(ct);

        foreach (var delivery in due)
        {
            var ev = await db.Events.FindAsync(new object[] { delivery.EventId }, ct);
            var sub = await db.Subscriptions.FindAsync(new object[] { delivery.SubscriptionId }, ct);

            if (ev is null || sub is null)
            {
                delivery.Status = DeliveryStatus.DeadLettered;
                delivery.CompletedAt = DateTime.UtcNow;
                continue;
            }

            delivery.AttemptCount++;
            var (success, attempt) = await AttemptDeliveryAsync(ev, sub, delivery.AttemptCount, ct);
            db.DeliveryAttempts.Add(attempt);

            if (success)
            {
                delivery.Status = DeliveryStatus.Delivered;
                delivery.CompletedAt = DateTime.UtcNow;
                _logger.LogInformation("Delivery {Id} succeeded on attempt {N}.", delivery.Id, delivery.AttemptCount);
            }
            else if (delivery.AttemptCount >= MaxAttempts)
            {
                delivery.Status = DeliveryStatus.DeadLettered;
                delivery.CompletedAt = DateTime.UtcNow;
                _logger.LogWarning("Delivery {Id} dead-lettered after {N} attempts.", delivery.Id, delivery.AttemptCount);
            }
            else
            {
                var delay = TimeSpan.FromSeconds(Math.Pow(2, delivery.AttemptCount));
                delivery.NextAttemptAt = DateTime.UtcNow.Add(delay);
                _logger.LogInformation("Delivery {Id} failed attempt {N}, retrying in {Delay}s.",
                    delivery.Id, delivery.AttemptCount, delay.TotalSeconds);
            }
        }

        if (due.Count > 0)
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