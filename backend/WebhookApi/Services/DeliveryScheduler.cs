using StackExchange.Redis;

namespace WebhookApi.Services;

// Wraps the Redis sorted set that tracks WHICH deliveries are due and WHEN.
// Member = delivery id (string). Score = next-attempt time as a Unix timestamp (seconds).
public class DeliveryScheduler
{
    private const string DueSetKey = "deliveries:due";
    private readonly IConnectionMultiplexer _redis;

    public DeliveryScheduler(IConnectionMultiplexer redis)
    {
        _redis = redis;
    }

    // Schedule a delivery to become due at a given time.
    // Re-adding an existing id just updates its score — that's how backoff reschedules.
    public async Task ScheduleAsync(Guid deliveryId, DateTime nextAttemptAt)
    {
        var db = _redis.GetDatabase();
        var score = new DateTimeOffset(nextAttemptAt, TimeSpan.Zero).ToUnixTimeSeconds();
        await db.SortedSetAddAsync(DueSetKey, deliveryId.ToString(), score);
    }

    // Fetch up to `count` delivery ids whose scheduled time is now or in the past.
    public async Task<List<Guid>> GetDueAsync(int count = 50)
    {
        var db = _redis.GetDatabase();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        // All members with score between the beginning of time and now.
        var due = await db.SortedSetRangeByScoreAsync(
            DueSetKey,
            start: double.NegativeInfinity,
            stop: now,
            take: count);

        return due.Select(v => Guid.Parse(v.ToString())).ToList();
    }

    // Remove a delivery from the set once it reaches a terminal state
    // (Delivered or DeadLettered) — it never needs scheduling again.
    public async Task RemoveAsync(Guid deliveryId)
    {
        var db = _redis.GetDatabase();
        await db.SortedSetRemoveAsync(DueSetKey, deliveryId.ToString());
    }

    // How many deliveries are currently scheduled (handy for diagnostics).
    public async Task<long> CountAsync()
    {
        var db = _redis.GetDatabase();
        return await db.SortedSetLengthAsync(DueSetKey);
    }
}