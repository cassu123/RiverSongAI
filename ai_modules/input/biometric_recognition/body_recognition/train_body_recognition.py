import torch
from torch.utils.data import DataLoader
from torchvision import datasets, transforms
from body_recognition_ai import BodyRecognitionAI

# Load configuration
import json
with open('configs/config.json') as config_file:
    config = json.load(config_file)

# Define transformations
transform = transforms.Compose([
    transforms.Resize(config['input_size']),
    transforms.ToTensor()
])

# Load datasets
train_dataset = datasets.ImageFolder('data/train', transform=transform)
val_dataset = datasets.ImageFolder('data/val', transform=transform)

train_loader = DataLoader(train_dataset, batch_size=config['batch_size'], shuffle=True)
val_loader = DataLoader(val_dataset, batch_size=config['batch_size'], shuffle=False)

# Initialize model, loss function, optimizer
model = BodyRecognitionAI()
criterion = torch.nn.CrossEntropyLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=config['learning_rate'])

# Training loop
for epoch in range(config['epochs']):
    model.train()
    for data, target in train_loader:
        optimizer.zero_grad()
        output = model(data)
        loss = criterion(output, target)
        loss.backward()
        optimizer.step()

    # Save checkpoint every few epochs
    if epoch % 10 == 0:
        torch.save(model.state_dict(), f'models/checkpoint_epoch_{epoch}.pth')

    # Log progress
    print(f"Epoch {epoch}, Loss: {loss.item()}")

# Save final model
torch.save(model.state_dict(), 'models/final_model.pth')
