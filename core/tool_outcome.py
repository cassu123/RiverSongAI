"""
ToolFailure: a tool result that says the tool did not do what was asked.

Tools return plain text, because the text goes straight back to the model.
Many catch their own errors and return a friendly sentence ("I tried to check
the weather ... but encountered an issue: ..."), so from outside a failure
looked exactly like a success: the agent loop marked it ok, and the Voice
page showed the call as done.

ToolFailure is a str. Every caller that treats a result as text keeps
working unchanged and the model reads the same words; code that needs to
know can check isinstance(result, ToolFailure).
"""


class ToolFailure(str):
    __slots__ = ()
