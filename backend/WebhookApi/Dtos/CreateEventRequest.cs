namespace WebhookApi.Dtos;

public record CreateEventRequest(string EventType, string? Payload);