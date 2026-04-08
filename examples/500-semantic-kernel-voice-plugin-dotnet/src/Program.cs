using Deepgram;
using DeepgramSemanticKernel;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;

var deepgramKey = Environment.GetEnvironmentVariable("DEEPGRAM_API_KEY");
var openaiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY");

if (string.IsNullOrEmpty(deepgramKey) || string.IsNullOrEmpty(openaiKey))
{
    Console.Error.WriteLine("Set DEEPGRAM_API_KEY and OPENAI_API_KEY environment variables.");
    Environment.Exit(2);
}

// Deepgram SDK requires explicit initialization
Library.Initialize();

try
{
    var builder = Kernel.CreateBuilder();
    builder.AddOpenAIChatCompletion("gpt-4o-mini", openaiKey);

    var kernel = builder.Build();
    kernel.ImportPluginFromType<DeepgramPlugin>("Deepgram");

    var chat = kernel.GetRequiredService<IChatCompletionService>();
    var history = new ChatHistory(
        "You are a helpful assistant with access to Deepgram voice tools. " +
        "You can transcribe audio from URLs or local files, and convert text to speech. " +
        "Use the Deepgram functions when the user asks about audio transcription or text-to-speech.");

    var settings = new OpenAIPromptExecutionSettings
    {
        FunctionChoiceBehavior = FunctionChoiceBehavior.Auto()
    };

    Console.WriteLine("Deepgram + Semantic Kernel Agent");
    Console.WriteLine("Type a message (or 'quit' to exit):");
    Console.WriteLine();

    while (true)
    {
        Console.Write("You: ");
        var input = Console.ReadLine();
        if (string.IsNullOrWhiteSpace(input) || input.Equals("quit", StringComparison.OrdinalIgnoreCase))
            break;

        history.AddUserMessage(input);

        var response = await chat.GetChatMessageContentAsync(history, settings, kernel);
        Console.WriteLine($"Agent: {response.Content}");
        Console.WriteLine();

        history.AddAssistantMessage(response.Content ?? "");
    }
}
finally
{
    Library.Terminate();
}
