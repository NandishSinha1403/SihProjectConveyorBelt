# Model Evaluation — Conveyor Belt Damage Detection

Weights: `belt_v1.pt`  
Dataset: `/Users/am_nandish/Documents/SihProjectConveyer/training/data/merged/data.yaml`  
Device: `mps`  
Generated: 2026-08-31 13:45

## Overall

| Metric | Value |
| --- | --- |
| mAP@.5 | **95.3%** |
| mAP@.5:.95 | 67.5% |
| Precision | 95.1% |
| Recall | 91.8% |
| Inference throughput | 35.3 FPS (28.4 ms/frame) |

## Per class

| Class | Precision | Recall | mAP@.5 | mAP@.5:.95 |
| --- | --- | --- | --- | --- |
| tear | 91.8% | 89.1% | 92.8% | 59.8% |
| hole | 95.7% | 86.3% | 93.6% | 59.7% |
| belt_joint | 97.8% | 100.0% | 99.5% | 83.1% |

## Published baselines

Guo et al., *Belt Tear Detection for Coal Mining Conveyors*, Micromachines 2022, Table 5. Their custom dataset holds 1092 images across crack/tear/scratch; FPS was measured on an NVIDIA RTX 2080s and is not directly comparable to the figure above.

| Method | Backbone | mAP@.5 | FPS |
| --- | --- | --- | --- |
| Multi-SVM | — | 61.3% | 28.4 |
| AdaBoost | — | 39.8% | 23.7 |
| YOLOv5m | Focus+CSP | 82.5% | 128.0 |
| SSD300 | VGG16 | 81.7% | 59.1 |
| Faster R-CNN | ResNet-101 | 86.4% | 7.4 |
| **This model** | YOLO11 | **95.3%** | **35.3** |

> Numbers are not strictly comparable — different datasets, class counts and hardware. The baseline is here to show the order of magnitude a well-tuned one-stage detector reaches on this task.
