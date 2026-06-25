using WebhookApi.Models;
using WebhookApi.Services;
using Xunit;

namespace WebhookApi.Tests;

public class DeliveryPolicyTests
{
    [Fact]
    public void Success_marks_delivery_as_delivered_with_no_retry()
    {
        var decision = DeliveryPolicy.Decide(attemptNumber: 1, success: true);

        Assert.Equal(DeliveryStatus.Delivered, decision.Status);
        Assert.Null(decision.RetryDelay);
    }

    [Fact]
    public void Failure_below_cap_schedules_a_retry()
    {
        var decision = DeliveryPolicy.Decide(attemptNumber: 1, success: false);

        Assert.Equal(DeliveryStatus.Pending, decision.Status);
        Assert.NotNull(decision.RetryDelay);
    }

    [Theory]
    [InlineData(1, 2)]   // after attempt 1, retry in 2s
    [InlineData(2, 4)]   // after attempt 2, retry in 4s
    [InlineData(3, 8)]   // after attempt 3, retry in 8s
    [InlineData(4, 16)]  // after attempt 4, retry in 16s
    public void Backoff_doubles_with_each_attempt(int attemptNumber, int expectedSeconds)
    {
        var decision = DeliveryPolicy.Decide(attemptNumber, success: false);

        Assert.Equal(expectedSeconds, decision.RetryDelay!.Value.TotalSeconds);
    }

    [Fact]
    public void Failure_at_max_attempts_dead_letters()
    {
        var decision = DeliveryPolicy.Decide(
            attemptNumber: DeliveryPolicy.MaxAttempts, success: false);

        Assert.Equal(DeliveryStatus.DeadLettered, decision.Status);
        Assert.Null(decision.RetryDelay);
    }

    [Fact]
    public void Failure_beyond_max_attempts_also_dead_letters()
    {
        var decision = DeliveryPolicy.Decide(
            attemptNumber: DeliveryPolicy.MaxAttempts + 1, success: false);

        Assert.Equal(DeliveryStatus.DeadLettered, decision.Status);
    }
}