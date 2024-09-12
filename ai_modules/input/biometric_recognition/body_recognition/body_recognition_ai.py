import torch
import torch.nn as nn

class BodyRecognitionAI(nn.Module):
    def __init__(self):
        super(BodyRecognitionAI, self).__init__()
        # Define your model architecture here
        self.conv1 = nn.Conv2d(3, 64, kernel_size=3, stride=1, padding=1)
        self.fc1 = nn.Linear(64 * 56 * 56, 1000)  # Adjust dimensions accordingly

    def forward(self, x):
        x = self.conv1(x)
        x = x.view(x.size(0), -1)  # Flatten
        x = self.fc1(x)
        return x
