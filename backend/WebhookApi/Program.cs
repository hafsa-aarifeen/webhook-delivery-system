using Microsoft.EntityFrameworkCore;
using WebhookApi.Data;
using WebhookApi.Models;
using WebhookApi.Dtos;
using WebhookApi.Filters;
using WebhookApi.Workers;
using System.Security.Cryptography;
using StackExchange.Redis;
using WebhookApi.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddHttpClient();
builder.Services.AddHostedService<DeliveryWorker>();
builder.Services.AddSingleton<IConnectionMultiplexer>(
    ConnectionMultiplexer.Connect(
        builder.Configuration.GetConnectionString("Redis") ?? "localhost:6379"));
builder.Services.AddSingleton<DeliveryScheduler>();
builder.Services.AddSingleton<SubscriptionCache>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors("AllowFrontend");

app.MapGet("/health", () => new { status = "ok" });

app.MapGet("/health/redis", async (IConnectionMultiplexer redis) =>
{
    var db = redis.GetDatabase();
    var latency = await db.PingAsync();
    return Results.Ok(new { redis = "ok", latencyMs = latency.TotalMilliseconds });
});

app.MapGet("/debug/cache/{eventType}", async (string eventType, IConnectionMultiplexer redis) =>
{
    var db = redis.GetDatabase();
    var cached = await db.StringGetAsync($"subscriptions:active:{eventType}");
    return Results.Ok(new
    {
        eventType,
        isCached = cached.HasValue,
        value = cached.HasValue ? cached.ToString() : "(not cached)"
    });
});

// --- Events ---
app.MapPost("/events", async (
    CreateEventRequest request,
    HttpContext context,
    AppDbContext db,
    IConnectionMultiplexer redis) =>
{
    if (string.IsNullOrWhiteSpace(request.EventType))
        return Results.BadRequest(new { error = "EventType is required." });

    var idempotencyKey = context.Request.Headers["Idempotency-Key"].ToString();
    var redisDb = redis.GetDatabase();

    // Have we seen this key before? If so, return the original event's id.
    if (!string.IsNullOrWhiteSpace(idempotencyKey))
    {
        var existingId = await redisDb.StringGetAsync($"idempotency:{idempotencyKey}");
        if (existingId.HasValue)
        {
            return Results.Ok(new
            {
                id = existingId.ToString(),
                duplicate = true,
                message = "Event already created with this Idempotency-Key."
            });
        }
    }

    var newEvent = new Event
    {
        Id = Guid.NewGuid(),
        EventType = request.EventType,
        Payload = request.Payload ?? string.Empty,
        CreatedAt = DateTime.UtcNow
    };

    db.Events.Add(newEvent);
    await db.SaveChangesAsync();

    // Remember this key for 24h so retries don't create duplicates.
    if (!string.IsNullOrWhiteSpace(idempotencyKey))
    {
        await redisDb.StringSetAsync(
            $"idempotency:{idempotencyKey}",
            newEvent.Id.ToString(),
            TimeSpan.FromHours(24));
    }

    return Results.Created($"/events/{newEvent.Id}", newEvent);
})
.AddEndpointFilter<ApiKeyEndpointFilter>();

app.MapGet("/events", async (AppDbContext db) =>
    await db.Events.OrderByDescending(e => e.CreatedAt).ToListAsync());

// --- Subscriptions ---
app.MapPost("/subscriptions", async (CreateSubscriptionRequest request, AppDbContext db, SubscriptionCache cache) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) ||
        string.IsNullOrWhiteSpace(request.Url) ||
        string.IsNullOrWhiteSpace(request.EventType))
    {
        return Results.BadRequest(new { error = "Name, Url and EventType are all required." });
    }

    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
        return Results.BadRequest(new { error = "Url must be a valid absolute URL (e.g. https://example.com/hook)." });

    // A unique signing key for this subscriber, shown once on creation.
    var secret = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    var subscription = new Subscription
    {
        Id = Guid.NewGuid(),
        Name = request.Name,
        Url = request.Url,
        EventType = request.EventType,
        IsActive = true,
        Secret = secret,
        CreatedAt = DateTime.UtcNow
    };

    db.Subscriptions.Add(subscription);
    await db.SaveChangesAsync();
    await cache.InvalidateAsync(subscription.EventType);

    return Results.Created($"/subscriptions/{subscription.Id}", subscription);
});

app.MapGet("/subscriptions", async (AppDbContext db) =>
    await db.Subscriptions
        .Select(s => new
        {
            s.Id,
            s.Name,
            s.Url,
            s.EventType,
            s.IsActive,
            s.CreatedAt
        })
        .ToListAsync());

app.MapDelete("/subscriptions/{id:guid}", async (Guid id, AppDbContext db, SubscriptionCache cache) =>
{
    var subscription = await db.Subscriptions.FindAsync(id);
    if (subscription is null)
        return Results.NotFound(new { error = "Subscription not found." });

    var eventType = subscription.EventType;   // capture before removal
    db.Subscriptions.Remove(subscription);
    await db.SaveChangesAsync();
    await cache.InvalidateAsync(eventType);

    return Results.NoContent();
});

app.MapPost("/test-receiver", async (HttpContext context, ILogger<Program> logger) =>
{
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();
    var signature = context.Request.Headers["X-Signature"].ToString();
    logger.LogInformation("Test receiver got a webhook. Signature: {Sig} Body: {Body}", signature, body);
    return Results.Ok(new { received = true });
});

app.MapPost("/test-receiver/fail", (ILogger<Program> logger) =>
{
    logger.LogInformation("Failing receiver: returning 500.");
    return Results.StatusCode(500);
});

var flakyCount = 0;
app.MapPost("/test-receiver/flaky", (ILogger<Program> logger) =>
{
    flakyCount++;
    if (flakyCount % 3 != 0)
    {
        logger.LogInformation("Flaky receiver: FAIL (call #{Count})", flakyCount);
        return Results.StatusCode(503);
    }
    logger.LogInformation("Flaky receiver: SUCCESS (call #{Count})", flakyCount);
    return Results.Ok(new { received = true });
});

app.MapGet("/delivery-attempts", async (AppDbContext db) =>
{
    var attempts = await (
        from a in db.DeliveryAttempts
        join e in db.Events on a.EventId equals e.Id into eventGroup
        from e in eventGroup.DefaultIfEmpty()
        join s in db.Subscriptions on a.SubscriptionId equals s.Id into subGroup
        from s in subGroup.DefaultIfEmpty()
        orderby a.AttemptedAt descending
        select new
        {
            a.Id,
            eventType = e != null ? e.EventType : "(deleted event)",
            subscriber = s != null ? s.Name : "(deleted subscriber)",
            subscriberUrl = s != null ? s.Url : null,
            a.Success,
            a.StatusCode,
            a.DurationMs,
            a.ErrorMessage,
            a.AttemptedAt
        }
    ).ToListAsync();

    return attempts;
});

app.MapGet("/deliveries", async (AppDbContext db) =>
{
    var rows = await (
        from d in db.Deliveries
        join e in db.Events on d.EventId equals e.Id into events
        from e in events.DefaultIfEmpty()
        join s in db.Subscriptions on d.SubscriptionId equals s.Id into subs
        from s in subs.DefaultIfEmpty()
        orderby d.CreatedAt descending
        select new
        {
            d.Id,
            EventType = e != null ? e.EventType : "(deleted event)",
            Subscriber = s != null ? s.Name : "(deleted subscriber)",
            d.Status,
            d.AttemptCount,
            d.NextAttemptAt,
            d.CreatedAt,
            d.CompletedAt
        }
    ).ToListAsync();

    // Status is an enum stored as a number; turn it into a readable word
    // for the dashboard. We do this in memory, after the DB query.
    var result = rows.Select(r => new
    {
        r.Id,
        r.EventType,
        r.Subscriber,
        Status = r.Status.ToString(),
        r.AttemptCount,
        r.NextAttemptAt,
        r.CreatedAt,
        r.CompletedAt
    });

    return Results.Ok(result);
});

app.MapPost("/deliveries/{id:guid}/retry", async (
    Guid id,
    AppDbContext db,
    DeliveryScheduler scheduler) =>
{
    var delivery = await db.Deliveries.FindAsync(id);
    if (delivery is null)
        return Results.NotFound(new { error = "Delivery not found." });

    // Only dead-lettered deliveries can be manually retried.
    if (delivery.Status != DeliveryStatus.DeadLettered)
        return Results.BadRequest(new { error = "Only dead-lettered deliveries can be retried." });

    // Reset it to a fresh pending state and re-schedule it now.
    delivery.Status = DeliveryStatus.Pending;
    delivery.AttemptCount = 0;
    delivery.NextAttemptAt = DateTime.UtcNow;
    delivery.CompletedAt = null;
    await db.SaveChangesAsync();

    await scheduler.ScheduleAsync(delivery.Id, delivery.NextAttemptAt);

    return Results.Ok(new { message = "Delivery re-queued for delivery.", deliveryId = delivery.Id });
});

app.Run();