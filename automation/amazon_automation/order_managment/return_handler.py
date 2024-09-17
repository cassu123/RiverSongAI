class ReturnHandler:
    def __init__(self, api_key):
        self.api_key = api_key

    def handle_return(self, return_data):
        """Handle a customer return."""
        print(f"Handling return: {return_data}")
        return "Return handled successfully."
