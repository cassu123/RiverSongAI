import openai

class OpenAIAI:
    def __init__(self, api_key):
        openai.api_key = api_key

    def query_openai(self, prompt):
        response = openai.Completion.create(
            engine="davinci", prompt=prompt, max_tokens=100
        )
        return response.choices[0].text.strip()
