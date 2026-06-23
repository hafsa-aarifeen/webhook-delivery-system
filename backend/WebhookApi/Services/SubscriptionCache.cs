using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using WebhookApi.Data;

namespace WebhookApi.Services;

// Caches "which active subscriptions match this event type" in Redis,
// sitting in front of Postgres. Read-heavy, write-rare data — ideal to cache.
public class SubscriptionCache
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);
    private readonly IConnectionMultiplexer _redis;

    public SubscriptionCache(IConnectionMultiplexer redis)
    {
        _redis = redis;
    }

    private static string Key(string eventType) => $"subscriptions:active:{eventType}";

    // Cache-aside read: try Redis first; on a miss, load from Postgres and populate.
    public async Task<List<Guid>> GetActiveSubscriptionIdsAsync(
        string eventType, AppDbContext db, CancellationToken ct)
    {
        var redisDb = _redis.GetDatabase();
        var cached = await redisDb.StringGetAsync(Key(eventType));

        if (cached.HasValue)
        {
            // HIT — answer comes from Redis, Postgres untouched.
            return JsonSerializer.Deserialize<List<Guid>>(cached.ToString()) ?? new List<Guid>();
        }

        // MISS — ask Postgres, then remember the answer for next time.
        var ids = await db.Subscriptions
            .Where(s => s.IsActive && s.EventType == eventType)
            .Select(s => s.Id)
            .ToListAsync(ct);

        await redisDb.StringSetAsync(Key(eventType), JsonSerializer.Serialize(ids), CacheTtl);
        return ids;
    }

    // Call this after ANY change to subscriptions of a given type
    // (create, delete, activate/deactivate) so the next read reloads fresh.
    public async Task InvalidateAsync(string eventType)
    {
        var redisDb = _redis.GetDatabase();
        await redisDb.KeyDeleteAsync(Key(eventType));
    }
}