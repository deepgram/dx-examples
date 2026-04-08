using System.ComponentModel;
using Deepgram;
using Deepgram.Clients.Interfaces.v1;
using Deepgram.Models.Listen.v1.REST;
using Deepgram.Models.Speak.v1.REST;
using Microsoft.SemanticKernel;

namespace DeepgramSemanticKernel;

public class DeepgramPlugin
{
    private readonly IListenRESTClient _listenClient;
    private readonly ISpeakRESTClient _speakClient;

    public DeepgramPlugin()
    {
        _listenClient = ClientFactory.CreateListenRESTClient();
        _speakClient = ClientFactory.CreateSpeakRESTClient();
    }

    [KernelFunction("transcribe_url")]
    [Description("Transcribes audio from a URL using Deepgram speech-to-text. Returns the transcript text.")]
    public async Task<string> TranscribeUrlAsync(
        [Description("The URL of the audio file to transcribe")] string url)
    {
        var response = await _listenClient.TranscribeUrl(
            new UrlSource(url),
            new PreRecordedSchema
            {
                Model = "nova-3",
                SmartFormat = true,
                // ← tag is REQUIRED so internal test traffic is identifiable
                Tag = new List<string> { "deepgram-examples" }
            });

        return response.Results!.Channels![0].Alternatives![0].Transcript!;
    }

    [KernelFunction("transcribe_file")]
    [Description("Transcribes a local audio file using Deepgram speech-to-text. Returns the transcript text.")]
    public async Task<string> TranscribeFileAsync(
        [Description("The absolute path to the local audio file")] string filePath)
    {
        var audioData = await File.ReadAllBytesAsync(filePath);

        var response = await _listenClient.TranscribeFile(
            audioData,
            new PreRecordedSchema
            {
                Model = "nova-3",
                SmartFormat = true,
                Tag = new List<string> { "deepgram-examples" }
            });

        return response.Results!.Channels![0].Alternatives![0].Transcript!;
    }

    [KernelFunction("speak_text")]
    [Description("Converts text to speech using Deepgram TTS. Saves the audio to a file and returns the file path.")]
    public async Task<string> SpeakTextAsync(
        [Description("The text to convert to speech")] string text,
        [Description("Output file path for the audio (e.g. output.mp3)")] string outputPath = "output.mp3")
    {
        await _speakClient.ToFile(
            new TextSource(text),
            outputPath,
            new SpeakSchema
            {
                Model = "aura-2-thalia-en"
            });

        return $"Audio saved to {outputPath}";
    }

    // Exposes ToStream for callers that need in-memory audio bytes
    [KernelFunction("speak_text_stream")]
    [Description("Converts text to speech and returns the raw audio bytes as a base64-encoded string.")]
    public async Task<string> SpeakTextStreamAsync(
        [Description("The text to convert to speech")] string text)
    {
        var response = await _speakClient.ToStream(
            new TextSource(text),
            new SpeakSchema
            {
                Model = "aura-2-thalia-en"
            });

        var bytes = response.Stream!.ToArray();
        return Convert.ToBase64String(bytes);
    }
}
