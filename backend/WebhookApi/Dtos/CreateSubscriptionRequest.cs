namespace WebhookApi.Dtos;

public record CreateSubscriptionRequest(string Name, string Url, string EventType);