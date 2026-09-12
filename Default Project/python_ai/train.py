import os
import yaml
from pathlib import Path
from ultralytics import YOLO

def create_data_yaml():
    data = {
        'path': str(Path(__file__).parent / 'data'),
        'train': 'train/images',
        'val': 'val/images',
        'test': 'test/images',
        'nc': 1,
        'names': ['onion'],
    }
    with open(Path(__file__).parent / 'data.yaml', 'w') as f:
        yaml.dump(data, f)
    return Path(__file__).parent / 'data.yaml'

def train_model():
    data_yaml = create_data_yaml()

    model = YOLO('yolov8n.pt')

    results = model.train(
        data=str(data_yaml),
        epochs=100,
        imgsz=640,
        batch=16,
        device=0 if os.getenv('CUDA_VISIBLE_DEVICES') else 'cpu',
        workers=8,
        patience=20,
        save=True,
        save_period=10,
        project='runs/train',
        name='onion_grading',
        exist_ok=True,
        pretrained=True,
        optimizer='AdamW',
        lr0=0.001,
        lrf=0.01,
        momentum=0.937,
        weight_decay=0.0005,
        warmup_epochs=3,
        warmup_momentum=0.8,
        warmup_bias_lr=0.1,
        box=7.5,
        cls=0.5,
        dfl=1.5,
        pose=12.0,
        kobj=1.0,
        label_smoothing=0.0,
        nbs=64,
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.4,
        degrees=0.0,
        translate=0.1,
        scale=0.5,
        shear=0.0,
        perspective=0.0,
        flipud=0.0,
        fliplr=0.5,
        mosaic=1.0,
        mixup=0.0,
        copy_paste=0.0,
    )

    print(f"Training completed. Best model saved to: {results.save_dir}/weights/best.pt")

    metrics = model.val()
    print(f"Validation mAP50: {metrics.box.map50:.4f}")
    print(f"Validation mAP50-95: {metrics.box.map:.4f}")

if __name__ == '__main__':
    train_model()