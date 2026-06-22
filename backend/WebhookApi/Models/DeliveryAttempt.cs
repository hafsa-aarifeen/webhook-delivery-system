namespace WebhookApi.Models;

public class DeliveryAttempt
{
    public Guid Id { get; set; }
    public Guid EventId { get; set; }
    public Guid SubscriptionId { get; set; }
    public int AttemptNumber { get; set; }
    public bool Success { get; set; }
    public int? StatusCode { get; set; }
    public string? ResponseBody { get; set; }
    public string? ErrorMessage { get; set; }
    public int DurationMs { get; set; }
    public DateTime AttemptedAt { get; set; }
}