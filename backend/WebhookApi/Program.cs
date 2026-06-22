using Microsoft.EntityFrameworkCore;
using WebhookApi.Data;
using WebhookApi.Models;
using WebhookApi.Dtos;
using WebhookApi.Filters;
using WebhookApi.Workers;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddHttpClient();
builder.Services.AddHostedService<DeliveryWorker>();

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

// --- Events ---
app.MapPost("/events", async (CreateEventRequest request, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.EventType))
        return Results.BadRequest(new { error = "EventType is required." });

    var newEvent = new Event
    {
        Id = Guid.NewGuid(),
        EventType = request.EventType,
        Payload = request.Payload ?? string.Empty,
        CreatedAt = DateTime.UtcNow
    };

    db.Events.Add(newEvent);
    await db.SaveChangesAsync();

    return Results.Created($"/events/{newEvent.Id}", newEvent);
})
.AddEndpointFilter<ApiKeyEndpointFilter>();

app.MapGet("/events", async (AppDbContext db) =>
    await db.Events.OrderByDescending(e => e.CreatedAt).ToListAsync());

// --- Subscriptions ---
app.MapPost("/subscriptions", async (CreateSubscriptionRequest request, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) ||
        string.IsNullOrWhiteSpace(request.Url) ||
        string.IsNullOrWhiteSpace(request.EventType))
    {
        return Results.BadRequest(new { error = "Name, Url and EventType are all required." });
    }

    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
        return Results.BadRequest(new { error = "Url must be a valid absolute URL (e.g. https://example.com/hook)." });

    var subscription = new Subscription
    {
        Id = Guid.NewGuid(),
        Name = request.Name,
        Url = request.Url,
        EventType = request.EventType,
        IsActive = true,
        CreatedAt = DateTime.UtcNow
    };

    db.Subscriptions.Add(subscription);
    await db.SaveChangesAsync();

    return Results.Created($"/subscriptions/{subscription.Id}", subscription);
});

app.MapGet("/subscriptions", async (AppDbContext db) =>
    await db.Subscriptions.ToListAsync());

app.MapDelete("/subscriptions/{id:guid}", async (Guid id, AppDbContext db) =>
{
    var subscription = await db.Subscriptions.FindAsync(id);
    if (subscription is null)
        return Results.NotFound(new { error = "Subscription not found." });

    db.Subscriptions.Remove(subscription);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

app.MapPost("/test-receiver", async (HttpContext context, ILogger<Program> logger) =>
{
    using var reader = new StreamReader(context.Request.Body);
    var body = await reader.ReadToEndAsync();
    logger.LogInformation("Test receiver got a webhook: {Body}", body);
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

app.Run();