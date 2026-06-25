# ---- Build stage: compile and publish using the full SDK ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy just the csproj first and restore — this layer caches unless deps change.
COPY WebhookApi.csproj .
RUN dotnet restore WebhookApi.csproj

# Copy the rest of the source and publish a release build.
COPY . .
RUN dotnet publish WebhookApi.csproj -c Release -o /app/publish

# ---- Runtime stage: small image with only the runtime + published app ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Render provides the port via the PORT env var; listen on it (default 8080).
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "WebhookApi.dll"]