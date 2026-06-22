namespace WebhookApi.Models;

public enum DeliveryStatus
{
    Pending,
    Delivered,
    DeadLettered
}

public class Delivery
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public Guid SubscriptionId { get; set; }
    public DeliveryStatus Status { get; set; }
    public int AttemptCount { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}