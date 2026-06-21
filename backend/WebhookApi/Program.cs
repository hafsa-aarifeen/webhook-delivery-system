using Microsoft.EntityFrameworkCore;
using WebhookApi.Data;
using WebhookApi.Models;
using WebhookApi.Dtos;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

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
});

app.Run();