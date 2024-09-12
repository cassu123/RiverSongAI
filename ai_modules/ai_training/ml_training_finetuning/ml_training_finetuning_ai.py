from config import config
from data_loader import load_and_preprocess_data_tf, load_and_preprocess_data_torch
from model_builder import build_model_tf, build_model_torch
from trainer import train_model_tf, train_model_torch, evaluate_model_tf, evaluate_model_torch

data_dir = "path_to_data"

if config["use_tensorflow"]:
    train_gen, val_gen = load_and_preprocess_data_tf(data_dir, config["input_size"], config["batch_size"])
    model = build_model_tf(config["model_name"], config["num_classes"])
    history = train_model_tf(model, train_gen, val_gen, config["epochs"], config["learning_rate"])
    evaluate_model_tf(model, val_gen)
else:
    train_loader, val_loader = load_and_preprocess_data_torch(data_dir, config["input_size"], config["batch_size"], config["dataset_type"])
    model = build_model_torch(config["num_classes"])
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = train_model_torch(model, train_loader, val_loader, config["epochs"], config["learning_rate"], device)
    evaluate_model_torch(model, val_loader, device)
