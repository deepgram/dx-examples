using Deepgram;
using DeepgramSemanticKernel;
using Xunit;

namespace DeepgramSemanticKernel.Tests;

public class DeepgramPluginTests : IDisposable
{
    private static readonly string[] RequiredVars = { "DEEPGRAM_API_KEY" };
    private readonly DeepgramPlugin _plugin;

    public DeepgramPluginTests()
    {
        var missing = RequiredVars.Where(k => string.IsNullOrEmpty(Environment.GetEnvironmentVariable(k))).ToList();
        if (missing.Count > 0)
        {
            Console.Error.WriteLine($"MISSING_CREDENTIALS: {string.Join(",", missing)}");
            Environment.Exit(2);
        }

        Library.Initialize();
        _plugin = new DeepgramPlugin();
    }

    public void Dispose()
    {
        Library.Terminate();
    }

    [Fact]
    public async Task TranscribeUrl_ReturnsNonEmptyTranscript()
    {
        // NASA audio sample — ~5 seconds of speech
        var url = "https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav";

        var transcript = await _plugin.TranscribeUrlAsync(url);

        Assert.False(string.IsNullOrWhiteSpace(transcript), "Transcript should not be empty");
        // Proportional check: ~5s of audio should produce at least 10 characters
        Assert.True(transcript.Length >= 10,
            $"Transcript too short ({transcript.Length} chars) for a multi-second audio clip");
    }

    [Fact]
    public async Task SpeakText_CreatesAudioFile()
    {
        var outputPath = Path.Combine(Path.GetTempPath(), $"dg_test_{Guid.NewGuid()}.mp3");

        try
        {
            var result = await _plugin.SpeakTextAsync("Hello from Deepgram and Semantic Kernel.", outputPath);

            Assert.Contains(outputPath, result);
            Assert.True(File.Exists(outputPath), "Audio file should be created");

            var fileInfo = new FileInfo(outputPath);
            // Even a short sentence produces at least a few KB of audio
            Assert.True(fileInfo.Length > 1000,
                $"Audio file too small ({fileInfo.Length} bytes) — expected real audio content");
        }
        finally
        {
            if (File.Exists(outputPath)) File.Delete(outputPath);
        }
    }

    [Fact]
    public async Task SpeakTextStream_ReturnsBase64Audio()
    {
        var base64 = await _plugin.SpeakTextStreamAsync("Testing Deepgram text to speech.");

        Assert.False(string.IsNullOrWhiteSpace(base64), "Base64 audio should not be empty");

        var bytes = Convert.FromBase64String(base64);
        Assert.True(bytes.Length > 1000,
            $"Audio data too small ({bytes.Length} bytes) — expected real audio content");
    }
}
