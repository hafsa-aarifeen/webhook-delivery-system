using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using WebhookApi.Data;
using WebhookApi.Models;

namespace WebhookApi.Workers;

public class DeliveryWorker : BackgroundService
{
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
                await ProcessPendingEventsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error while processing events.");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    private async Task ProcessPendingEventsAsync(CancellationToken stoppingToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var pendingEvents = await db.Events
            .Where(e => e.ProcessedAt == null)
            .ToListAsync(stoppingToken);

        foreach (var ev in pendingEvents)
        {
            var subscribers = await db.Subscriptions
                .Where(s => s.IsActive && s.EventType == ev.EventType)
                .ToListAsync(stoppingToken);

            foreach (var sub in subscribers)
            {
                await DeliverAsync(db, ev, sub, stoppingToken);
            }

            ev.ProcessedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(stoppingToken);
        }
    }

    private async Task DeliverAsync(AppDbContext db, Event ev, Subscription sub, CancellationToken stoppingToken)
    {
        var attempt = new DeliveryAttempt
        {
            Id = Guid.NewGuid(),
            EventId = ev.Id,
            SubscriptionId = sub.Id,
            AttemptNumber = 1,
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
            var content = new StringContent(payload, Encoding.UTF8, "application/json");
            var response = await client.PostAsync(sub.Url, content, stoppingToken);
            stopwatch.Stop();

            var body = await response.Content.ReadAsStringAsync(stoppingToken);
            attempt.StatusCode = (int)response.StatusCode;
            attempt.Success = response.IsSuccessStatusCode;
            attempt.ResponseBody = body.Length > 1000 ? body[..1000] : body;
            attempt.DurationMs = (int)stopwatch.ElapsedMilliseconds;
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            attempt.Success = false;
            attempt.ErrorMessage = ex.Message;
            attempt.DurationMs = (int)stopwatch.ElapsedMilliseconds;
        }

        db.DeliveryAttempts.Add(attempt);

        _logger.LogInformation(
            "Event {EventId} -> {Url}: success={Success} status={Status} ({Duration}ms)",
            ev.Id, sub.Url, attempt.Success, attempt.StatusCode, attempt.DurationMs);
    }
}