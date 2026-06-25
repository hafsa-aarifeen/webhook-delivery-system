namespace WebhookApi.Services;

using WebhookApi.Models;

// The pure decision logic for what happens after a delivery attempt.
// No database, no HTTP — just inputs to outputs, so it's trivially testable.
public static class DeliveryPolicy
{
    public const int MaxAttempts = 5;

    public record Decision(DeliveryStatus Status, TimeSpan? RetryDelay);

    // Given the attempt number just made and whether it succeeded,
    // decide the delivery's new status and (if retrying) the backoff delay.
    public static Decision Decide(int attemptNumber, bool success)
    {
        if (success)
            return new Decision(DeliveryStatus.Delivered, null);

        if (attemptNumber >= MaxAttempts)
            return new Decision(DeliveryStatus.DeadLettered, null);

        // Exponential backoff: 2^attemptNumber seconds (2, 4, 8, 16…).
        var delay = TimeSpan.FromSeconds(Math.Pow(2, attemptNumber));
        return new Decision(DeliveryStatus.Pending, delay);
    }
}