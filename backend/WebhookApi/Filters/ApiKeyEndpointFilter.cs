namespace WebhookApi.Filters;

public class ApiKeyEndpointFilter : IEndpointFilter
{
    private const string ApiKeyHeader = "X-Api-Key";
    private readonly string? _expectedApiKey;

    public ApiKeyEndpointFilter(IConfiguration configuration)
    {
        _expectedApiKey = configuration["IngestApiKey"];
    }

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var providedKey = context.HttpContext.Request.Headers[ApiKeyHeader].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(providedKey) || providedKey != _expectedApiKey)
        {
            return Results.Unauthorized();
        }

        return await next(context);
    }
}