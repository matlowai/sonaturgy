"""Training router: dataset management, preprocessing, training, export."""

import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from web.backend.dependencies import get_dit_handler, get_llm_handler
from web.backend.schemas.common import ApiResponse
from web.backend.schemas.training import (
    ScanDatasetRequest,
    AutoLabelRequest,
    SampleEdit,
    SaveDatasetRequest,
    LoadDatasetRequest,
    PreprocessRequest,
    TrainingRequest,
    TrainingStatusResponse,
    ExportLoRARequest,
)

router = APIRouter()

# Training state
_dataset_builder = None
_trainer = None
_training_thread: Optional[threading.Thread] = None
_training_status = TrainingStatusResponse()


def _get_dataset_builder():
    global _dataset_builder
    if _dataset_builder is None:
        from acestep.training.dataset_builder import DatasetBuilder
        _dataset_builder = DatasetBuilder()
    return _dataset_builder


@router.post("/dataset/scan")
def scan_dataset(req: ScanDatasetRequest):
    builder = _get_dataset_builder()
    try:
        samples, msg = builder.scan_directory(req.directory)
        return ApiResponse(data={"count": len(samples), "message": msg})
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/dataset/auto-label")
def auto_label(
    req: AutoLabelRequest,
    dit=Depends(get_dit_handler),
    llm=Depends(get_llm_handler),
):
    builder = _get_dataset_builder()
    try:
        samples, msg = builder.label_all_samples(
            dit_handler=dit,
            llm_handler=llm,
            format_lyrics=req.format_lyrics,
            transcribe_lyrics=req.transcribe_lyrics,
            skip_metas=req.skip_metas,
            only_unlabeled=req.only_unlabeled,
        )
        return ApiResponse(data={"count": len(samples), "message": msg})
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/dataset/samples")
def get_samples():
    builder = _get_dataset_builder()
    return ApiResponse(data=[s.to_dict() for s in builder.samples])


@router.put("/dataset/sample/{idx}")
def edit_sample(idx: int, edit: SampleEdit):
    builder = _get_dataset_builder()
    try:
        sample, msg = builder.update_sample(idx, **edit.model_dump(exclude_none=True))
        return ApiResponse(data={"sample": sample.to_dict(), "message": msg})
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/dataset/save")
def save_dataset(req: SaveDatasetRequest):
    builder = _get_dataset_builder()
    try:
        msg = builder.save_dataset(req.path, dataset_name=req.dataset_name)
        return ApiResponse(data={"message": msg})
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/dataset/load")
def load_dataset(req: LoadDatasetRequest):
    builder = _get_dataset_builder()
    try:
        samples, msg = builder.load_dataset(req.path)
        return ApiResponse(data={"count": len(samples), "message": msg})
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/preprocess")
def preprocess(req: PreprocessRequest, dit=Depends(get_dit_handler)):
    builder = _get_dataset_builder()
    try:
        paths, msg = builder.preprocess_to_tensors(
            dit_handler=dit,
            output_dir=req.output_dir,
            max_duration=req.max_duration,
        )
        return ApiResponse(data={"count": len(paths), "message": msg})
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/start")
def start_training(req: TrainingRequest, dit=Depends(get_dit_handler)):
    global _trainer, _training_thread, _training_status

    if _training_thread and _training_thread.is_alive():
        raise HTTPException(400, "Training already running")

    from acestep.training.trainer import LoRATrainer
    from acestep.training.configs import TrainingConfig, LoRAConfig

    lora_config = LoRAConfig(
        r=req.rank,
        alpha=req.alpha,
        dropout=req.dropout,
    )
    train_config = TrainingConfig(
        output_dir=req.output_dir,
        learning_rate=req.learning_rate,
        max_epochs=req.max_epochs,
        batch_size=req.batch_size,
        gradient_accumulation_steps=req.gradient_accumulation_steps,
        save_every_n_epochs=req.save_every_n_epochs,
        warmup_steps=req.warmup_steps,
        seed=req.seed,
    )

    _trainer = LoRATrainer(
        dit_handler=dit,
        lora_config=lora_config,
        training_config=train_config,
    )
    _training_status = TrainingStatusResponse(
        running=True,
        total_epochs=req.max_epochs,
    )

    training_state = {"stop": False}

    def _train():
        global _training_status
        try:
            for step, loss, status_msg in _trainer.train_from_preprocessed(
                tensor_dir=req.tensor_dir,
                training_state=training_state,
            ):
                _training_status.step = step
                _training_status.loss = loss
                _training_status.message = status_msg
                _training_status.losses.append(loss)
        except Exception as e:
            _training_status.running = False
            _training_status.message = f"Training failed: {e}"
            raise
        _training_status.running = False
        _training_status.message = "Training complete"

    _training_thread = threading.Thread(target=_train, daemon=True)
    _training_thread.start()
    return ApiResponse(data={"message": "Training started"})


@router.get("/status")
def training_status():
    return ApiResponse(data=_training_status)


@router.post("/stop")
def stop_training():
    global _trainer, _training_status
    if _trainer:
        _trainer.stop()
        _training_status.running = False
        _training_status.message = "Training stopped"
    return ApiResponse(data={"message": "Training stopped"})


@router.post("/export")
def export_lora(req: ExportLoRARequest, dit=Depends(get_dit_handler)):
    try:
        from acestep.training.lora_utils import save_lora_weights
        path = save_lora_weights(
            model=dit.model,
            output_dir=req.output_dir,
            save_full_model=req.save_full_model,
        )
        return ApiResponse(data={"message": f"Exported to {path}", "path": path})
    except Exception as e:
        raise HTTPException(500, str(e))
