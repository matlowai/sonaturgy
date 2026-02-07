"""Unified diffusion loop for ACE-Step 1.5 models.

Replaces the per-model generate_audio() methods with a single function that
handles all 6 model variants (base, sft, turbo, turbo-shift1, turbo-shift3,
turbo-continuous). This enables:
1. Single place to add init_latents/t_start for the Pipeline Builder
2. No modifications to gitignored checkpoint model files
3. Consistent behavior across all variants

The 6 checkpoint files differ in only 3 dimensions:
  - CFG guidance: base/sft=yes (~60 lines), all turbo=no
  - Timestep scheduling: 4 strategies (linear, discrete, continuous, custom)
  - SDE re-noise: base/sft use unshifted linear t, turbo uses schedule t

Everything else (prepare_condition, prepare_noise, decoder, get_x0_from_noise,
renoise) is identical and called via model's public methods.

Usage (in handler.py):
    from acestep.diffusion_core import generate_audio_core
    outputs = generate_audio_core(model, variant="acestep-v15-turbo", **generate_kwargs)
"""

import os
import time
import importlib.util
from dataclasses import dataclass
from typing import Optional, List, Union, Dict, Any, Tuple

import torch
from loguru import logger
from transformers.cache_utils import DynamicCache, EncoderDecoderCache


# ── Lazy import for APG/ADG guidance (only needed for base/sft) ────────

_guidance_module = None


def _load_guidance_module():
    """Load APG/ADG guidance functions from checkpoint apg_guidance.py."""
    global _guidance_module
    if _guidance_module is not None:
        return _guidance_module

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for model_dir in ["acestep-v15-base", "acestep-v15-sft"]:
        path = os.path.join(project_root, "checkpoints", model_dir, "apg_guidance.py")
        if os.path.exists(path):
            spec = importlib.util.spec_from_file_location("apg_guidance", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _guidance_module = mod
            return _guidance_module

    raise ImportError(
        "Cannot find apg_guidance.py in checkpoints directory. "
        "Ensure base or sft model is downloaded."
    )


# ── Variant Configuration ──────────────────────────────────────────────


@dataclass(frozen=True)
class VariantConfig:
    """Configuration capturing how a model variant's diffusion loop differs."""
    use_cfg: bool               # CFG guidance supported (base/sft only)
    timestep_mode: str          # "linear" | "discrete" | "continuous"
    default_shift: float        # Default shift value if user doesn't specify
    forced_shift: Optional[float]  # Overrides user shift (turbo-shift3 = 3.0)
    default_steps: int          # Default step count
    sde_renoise_linear: bool    # base/sft: renoise uses unshifted linear timestep
    custom_timesteps: str       # "none" | "with_terminal" | "strip_zeros" | "map_nearest"
    shift_range: Optional[Tuple[float, float]]  # Clamp range (continuous = [1,5])


MODEL_VARIANT_CONFIGS: Dict[str, VariantConfig] = {
    "acestep-v15-base": VariantConfig(
        use_cfg=True, timestep_mode="linear", default_shift=1.0,
        forced_shift=None, default_steps=30, sde_renoise_linear=True,
        custom_timesteps="none", shift_range=None,
    ),
    "acestep-v15-sft": VariantConfig(
        use_cfg=True, timestep_mode="linear", default_shift=1.0,
        forced_shift=None, default_steps=30, sde_renoise_linear=True,
        custom_timesteps="with_terminal", shift_range=None,
    ),
    "acestep-v15-turbo": VariantConfig(
        use_cfg=False, timestep_mode="discrete", default_shift=3.0,
        forced_shift=None, default_steps=8, sde_renoise_linear=False,
        custom_timesteps="map_nearest", shift_range=None,
    ),
    "acestep-v15-turbo-shift1": VariantConfig(
        use_cfg=False, timestep_mode="linear", default_shift=1.0,
        forced_shift=None, default_steps=8, sde_renoise_linear=False,
        custom_timesteps="with_terminal", shift_range=None,
    ),
    "acestep-v15-turbo-shift3": VariantConfig(
        use_cfg=False, timestep_mode="linear", default_shift=1.0,
        forced_shift=3.0, default_steps=8, sde_renoise_linear=False,
        custom_timesteps="with_terminal", shift_range=None,
    ),
    "acestep-v15-turbo-continuous": VariantConfig(
        use_cfg=False, timestep_mode="continuous", default_shift=3.0,
        forced_shift=None, default_steps=8, sde_renoise_linear=False,
        custom_timesteps="strip_zeros", shift_range=(1.0, 5.0),
    ),
}


# ── Turbo (default) pre-defined schedules ──────────────────────────────

TURBO_VALID_SHIFTS = [1.0, 2.0, 3.0]

TURBO_VALID_TIMESTEPS = [
    1.0, 0.9545454545454546, 0.9333333333333333, 0.9, 0.875,
    0.8571428571428571, 0.8333333333333334, 0.7692307692307693, 0.75,
    0.6666666666666666, 0.6428571428571429, 0.625, 0.5454545454545454,
    0.5, 0.4, 0.375, 0.3, 0.25, 0.2222222222222222, 0.125,
]

TURBO_SHIFT_TIMESTEPS = {
    1.0: [1.0, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125],
    2.0: [1.0, 0.9333333333333333, 0.8571428571428571, 0.7692307692307693,
          0.6666666666666666, 0.5454545454545454, 0.4, 0.2222222222222222],
    3.0: [1.0, 0.9545454545454546, 0.9, 0.8333333333333334, 0.75,
          0.6428571428571429, 0.5, 0.3],
}


# ── Timestep Scheduler ─────────────────────────────────────────────────


class TimestepScheduler:
    """Computes and manipulates timestep schedules for all variant strategies.

    All schedules are returned as tensors of shape [N+1] where:
    - schedule[0..N-1] are the N evaluation timesteps (where decoder runs)
    - schedule[N] is a terminal value used for ODE dt on the second-to-last step
    The diffusion loop runs N steps total.
    """

    @staticmethod
    def compute(
        config: VariantConfig,
        num_steps: int,
        shift: float,
        timesteps: Optional[torch.Tensor],
        device: torch.device,
        dtype: torch.dtype,
        scheduler_explicit: bool = False,
    ) -> torch.Tensor:
        """Compute the full timestep schedule for a variant.

        Args:
            scheduler_explicit: True if user explicitly chose the scheduler from dropdown.
                               If True and discrete is selected with steps != 8, raises error.
                               If False (auto), falls back to linear gracefully.
        """
        if config.forced_shift is not None:
            shift = config.forced_shift

        # Try custom timesteps first
        if timesteps is not None and config.custom_timesteps != "none":
            result = TimestepScheduler._try_custom(config, timesteps, device, dtype)
            if result is not None:
                return result
            logger.warning("Custom timesteps invalid, falling back to default schedule")

        # Default schedule computation per timestep_mode
        if config.timestep_mode == "discrete":
            return TimestepScheduler._discrete(shift, device, dtype, num_steps, scheduler_explicit)
        elif config.timestep_mode == "continuous":
            return TimestepScheduler._continuous(num_steps, shift, config, device, dtype)
        else:  # "linear"
            return TimestepScheduler._linear(num_steps, shift, device, dtype)

    @staticmethod
    def _linear(num_steps: int, shift: float, device, dtype) -> torch.Tensor:
        """linspace(1, 0, N+1) + shift formula. Used by base, sft, shift1, shift3."""
        t = torch.linspace(1.0, 0.0, num_steps + 1, device=device, dtype=dtype)
        if shift != 1.0:
            t = shift * t / (1 + (shift - 1) * t)
        return t

    @staticmethod
    def _discrete(shift: float, device, dtype, num_steps: int = 8,
                  scheduler_explicit: bool = False) -> torch.Tensor:
        """Pre-defined turbo schedules (8 steps for shifts 1/2/3), plus terminal 0.

        Only supports 8 steps. For other step counts:
        - If scheduler was explicitly chosen: raise error (user should pick linear/continuous)
        - If scheduler is model default (auto): fall back to linear gracefully
        """
        if num_steps != 8:
            if scheduler_explicit:
                raise ValueError(
                    f"Discrete scheduler only supports 8 steps (got {num_steps}). "
                    f"Use 'linear' or 'continuous' scheduler for custom step counts."
                )
            # Auto mode: fall back to linear for non-8 step counts
            logger.info(
                f"[TimestepScheduler] Discrete schedule requires 8 steps, "
                f"using linear for {num_steps} steps."
            )
            return TimestepScheduler._linear(num_steps, shift, device, dtype)

        original_shift = shift
        shift = min(TURBO_VALID_SHIFTS, key=lambda x: abs(x - shift))
        if original_shift != shift:
            logger.warning(
                f"shift={original_shift} not supported for turbo, "
                f"rounded to nearest valid shift={shift}"
            )
        vals = TURBO_SHIFT_TIMESTEPS[shift] + [0.0]
        return torch.tensor(vals, device=device, dtype=dtype)

    @staticmethod
    def _continuous(num_steps: int, shift: float, config: VariantConfig,
                    device, dtype) -> torch.Tensor:
        """Continuous shift [1-5] schedule, plus terminal 0."""
        if config.shift_range:
            lo, hi = config.shift_range
            if shift < lo or shift > hi:
                original = shift
                shift = max(lo, min(hi, shift))
                logger.warning(
                    f"shift={original} out of range [{lo},{hi}], clamped to {shift}"
                )

        # N values: (N-i)/N for i in 0..N-1 → shifted
        linear_ts = [(num_steps - i) / num_steps for i in range(num_steps)]
        shifted = [shift * t / (1 + (shift - 1) * t) for t in linear_ts]
        shifted.append(0.0)
        return torch.tensor(shifted, device=device, dtype=dtype)

    @staticmethod
    def _try_custom(config: VariantConfig, timesteps: torch.Tensor,
                    device, dtype) -> Optional[torch.Tensor]:
        """Process custom timesteps. Returns None if invalid (caller falls back)."""
        ts_list = timesteps.tolist() if isinstance(timesteps, torch.Tensor) else list(timesteps)

        if config.custom_timesteps == "with_terminal":
            # SFT, shift1, shift3: timesteps include terminal, use as-is
            if len(ts_list) < 2:
                return None
            return torch.tensor(ts_list, device=device, dtype=dtype)

        # Turbo-style: strip trailing zeros
        while ts_list and ts_list[-1] == 0:
            ts_list.pop()

        if not ts_list:
            return None

        if config.custom_timesteps == "map_nearest":
            # Turbo default: map to nearest valid timestep, max 20
            if len(ts_list) > 20:
                logger.warning(
                    f"timesteps length={len(ts_list)} exceeds max 20, truncating"
                )
                ts_list = ts_list[:20]
            original = ts_list.copy()
            ts_list = [
                min(TURBO_VALID_TIMESTEPS, key=lambda x, t=t: abs(x - t))
                for t in ts_list
            ]
            if original != ts_list:
                logger.warning(f"timesteps mapped to nearest valid: {original} -> {ts_list}")

        # "strip_zeros" and "map_nearest" both: append terminal 0
        ts_list.append(0.0)
        return torch.tensor(ts_list, device=device, dtype=dtype)

    @staticmethod
    def truncate(schedule: torch.Tensor, t_start: float) -> torch.Tensor:
        """Truncate schedule for partial denoising (Pipeline Builder hook).

        Finds the first evaluation timestep <= t_start and returns schedule
        from that point onward, preserving the terminal value.
        """
        if t_start >= 1.0 - 1e-6:
            return schedule

        # Search only evaluation timesteps (exclude terminal)
        eval_ts = schedule[:-1]
        mask = eval_ts <= t_start + 1e-6
        if not mask.any():
            logger.warning(
                f"No timestep <= t_start={t_start} in schedule, using full schedule"
            )
            return schedule

        start_idx = mask.nonzero()[0].item()
        # Return from start_idx through terminal
        return schedule[start_idx:]


# ── Main unified diffusion function ───────────────────────────────────


def generate_audio_core(
    model,
    *,
    variant: str = "acestep-v15-turbo",
    # Conditioning inputs (passed through to model.prepare_condition)
    text_hidden_states: torch.FloatTensor,
    text_attention_mask: torch.FloatTensor,
    lyric_hidden_states: torch.FloatTensor,
    lyric_attention_mask: torch.FloatTensor,
    refer_audio_acoustic_hidden_states_packed: torch.FloatTensor,
    refer_audio_order_mask: torch.LongTensor,
    src_latents: torch.FloatTensor,
    chunk_masks: torch.FloatTensor,
    is_covers: torch.Tensor,
    silence_latent: Optional[torch.FloatTensor] = None,
    # Generation params
    seed: Optional[Union[int, List[int]]] = None,
    infer_method: str = "ode",
    infer_steps: Optional[int] = None,
    audio_cover_strength: float = 1.0,
    non_cover_text_hidden_states: Optional[torch.FloatTensor] = None,
    non_cover_text_attention_mask: Optional[torch.FloatTensor] = None,
    precomputed_lm_hints_25Hz: Optional[torch.FloatTensor] = None,
    # CFG params (base/sft only — ignored for turbo variants)
    diffusion_guidance_sale: float = 1.0,
    use_adg: bool = False,
    cfg_interval_start: float = 0.0,
    cfg_interval_end: float = 1.0,
    # Schedule params
    shift: Optional[float] = None,
    timesteps: Optional[torch.Tensor] = None,
    scheduler_override: Optional[str] = None,  # Override timestep_mode: "linear", "discrete", "continuous"
    # Pipeline Builder params (Phase 1)
    init_latents: Optional[torch.Tensor] = None,
    t_start: float = 1.0,
    **kwargs,
) -> Dict[str, Any]:
    """Unified diffusion loop replacing per-model generate_audio() methods.

    Accepts the same kwargs as handler.py's generate_kwargs dict, plus
    ``variant`` to select model-specific behavior and ``init_latents``/``t_start``
    for pipeline multi-stage denoising.

    Returns:
        Dict with "target_latents" and "time_costs" (same structure as
        the original model.generate_audio()).
    """
    config = MODEL_VARIANT_CONFIGS.get(variant)
    if config is None:
        raise ValueError(
            f"Unknown variant '{variant}'. "
            f"Valid: {list(MODEL_VARIANT_CONFIGS.keys())}"
        )

    # ── Apply scheduler override if provided ──────────────────────────
    if scheduler_override is not None and scheduler_override in ("linear", "discrete", "continuous"):
        if scheduler_override != config.timestep_mode:
            logger.info(
                f"[generate_audio_core] Overriding timestep_mode: "
                f"{config.timestep_mode} -> {scheduler_override}"
            )
            # Create modified config with new timestep_mode
            config = VariantConfig(
                use_cfg=config.use_cfg,
                timestep_mode=scheduler_override,
                default_shift=config.default_shift,
                forced_shift=config.forced_shift,
                default_steps=config.default_steps,
                sde_renoise_linear=config.sde_renoise_linear,
                custom_timesteps=config.custom_timesteps,
                shift_range=config.shift_range,
            )

    # ── Resolve defaults ──────────────────────────────────────────────
    if shift is None:
        shift = config.default_shift
    if infer_steps is None:
        infer_steps = config.default_steps

    # ── Attention mask (all variants create this identically) ─────────
    attention_mask = torch.ones(
        src_latents.shape[0], src_latents.shape[1],
        device=src_latents.device, dtype=src_latents.dtype,
    )

    # ── Timekeeping ───────────────────────────────────────────────────
    time_costs = {}
    start_time = time.time()
    total_start_time = start_time

    # ── Prepare conditions ────────────────────────────────────────────
    encoder_hidden_states, encoder_attention_mask, context_latents = (
        model.prepare_condition(
            text_hidden_states=text_hidden_states,
            text_attention_mask=text_attention_mask,
            lyric_hidden_states=lyric_hidden_states,
            lyric_attention_mask=lyric_attention_mask,
            refer_audio_acoustic_hidden_states_packed=refer_audio_acoustic_hidden_states_packed,
            refer_audio_order_mask=refer_audio_order_mask,
            hidden_states=src_latents,
            attention_mask=attention_mask,
            silence_latent=silence_latent,
            src_latents=src_latents,
            chunk_masks=chunk_masks,
            is_covers=is_covers,
            precomputed_lm_hints_25Hz=precomputed_lm_hints_25Hz,
        )
    )

    # Non-cover conditions (for cover task blending)
    encoder_hidden_states_non_cover = None
    encoder_attention_mask_non_cover = None
    context_latents_non_cover = None

    if audio_cover_strength < 1.0:
        non_is_covers = torch.zeros_like(is_covers)
        silence_latent_expanded = silence_latent[
            :, :src_latents.shape[1], :
        ].expand(src_latents.shape[0], -1, -1)
        (
            encoder_hidden_states_non_cover,
            encoder_attention_mask_non_cover,
            context_latents_non_cover,
        ) = model.prepare_condition(
            text_hidden_states=non_cover_text_hidden_states,
            text_attention_mask=non_cover_text_attention_mask,
            lyric_hidden_states=lyric_hidden_states,
            lyric_attention_mask=lyric_attention_mask,
            refer_audio_acoustic_hidden_states_packed=refer_audio_acoustic_hidden_states_packed,
            refer_audio_order_mask=refer_audio_order_mask,
            hidden_states=silence_latent_expanded,
            attention_mask=attention_mask,
            silence_latent=silence_latent,
            src_latents=silence_latent_expanded,
            chunk_masks=chunk_masks,
            is_covers=non_is_covers,
            precomputed_lm_hints_25Hz=None,
            audio_codes=None,
        )

    end_time = time.time()
    time_costs["encoder_time_cost"] = end_time - start_time
    start_time = end_time

    # ── Build timestep schedule ───────────────────────────────────────
    device = context_latents.device
    dtype = context_latents.dtype
    bsz = context_latents.shape[0]

    schedule = TimestepScheduler.compute(
        config, infer_steps, shift, timesteps, device, dtype,
        scheduler_explicit=(scheduler_override is not None),
    )

    # Pipeline Builder: truncate schedule for partial denoising
    if init_latents is not None and t_start < 1.0:
        schedule = TimestepScheduler.truncate(schedule, t_start)

    num_steps = len(schedule) - 1  # exclude terminal value
    cover_steps = int(num_steps * audio_cover_strength)

    # ── Prepare initial latent ────────────────────────────────────────
    if init_latents is not None:
        xt = init_latents.to(device=device, dtype=dtype)
    else:
        xt = model.prepare_noise(context_latents, seed)

    # ── CFG setup (base/sft only) ─────────────────────────────────────
    do_cfg_guidance = config.use_cfg and diffusion_guidance_sale > 1.0
    guidance_mod = None
    momentum_buffer = None

    if do_cfg_guidance:
        guidance_mod = _load_guidance_module()
        momentum_buffer = guidance_mod.MomentumBuffer()

        # Double batch: [conditional, unconditional]
        null_emb = model.null_condition_emb.expand_as(encoder_hidden_states)
        encoder_hidden_states = torch.cat(
            [encoder_hidden_states, null_emb], dim=0,
        )
        encoder_attention_mask = torch.cat(
            [encoder_attention_mask, encoder_attention_mask], dim=0,
        )
        context_latents = torch.cat(
            [context_latents, context_latents], dim=0,
        )
        attention_mask = torch.cat(
            [attention_mask, attention_mask], dim=0,
        )

    # ── KV cache ──────────────────────────────────────────────────────
    past_key_values = EncoderDecoderCache(DynamicCache(), DynamicCache())
    cover_cfg_doubled = False  # Track CFG doubling of non-cover states (once only)

    # ── Diffusion loop ────────────────────────────────────────────────
    with torch.inference_mode():
        for step_idx in range(num_steps):
            t_curr = schedule[step_idx].item()

            # Cover condition switch: reassign + reset KV every iteration
            # after cover_steps (matches original per-step reset behavior).
            # CFG doubling of non-cover states happens only once (bugfix).
            if step_idx >= cover_steps and encoder_hidden_states_non_cover is not None:
                if do_cfg_guidance and not cover_cfg_doubled:
                    cover_cfg_doubled = True
                    null_emb_nc = model.null_condition_emb.expand_as(
                        encoder_hidden_states_non_cover,
                    )
                    encoder_hidden_states_non_cover = torch.cat(
                        [encoder_hidden_states_non_cover, null_emb_nc], dim=0,
                    )
                    encoder_attention_mask_non_cover = torch.cat(
                        [encoder_attention_mask_non_cover,
                         encoder_attention_mask_non_cover], dim=0,
                    )
                    context_latents_non_cover = torch.cat(
                        [context_latents_non_cover, context_latents_non_cover],
                        dim=0,
                    )

                encoder_hidden_states = encoder_hidden_states_non_cover
                encoder_attention_mask = encoder_attention_mask_non_cover
                context_latents = context_latents_non_cover
                past_key_values = EncoderDecoderCache(
                    DynamicCache(), DynamicCache(),
                )

            # ── Decoder forward ───────────────────────────────────────
            if do_cfg_guidance:
                x_in = torch.cat([xt, xt], dim=0)
                t_in = t_curr * torch.ones(
                    (x_in.shape[0],), device=device, dtype=dtype,
                )
            else:
                x_in = xt
                t_in = t_curr * torch.ones(
                    (bsz,), device=device, dtype=dtype,
                )

            decoder_outputs = model.decoder(
                hidden_states=x_in,
                timestep=t_in,
                timestep_r=t_in,
                attention_mask=attention_mask,
                encoder_hidden_states=encoder_hidden_states,
                encoder_attention_mask=encoder_attention_mask,
                context_latents=context_latents,
                use_cache=True,
                past_key_values=past_key_values,
            )

            vt = decoder_outputs[0]
            past_key_values = decoder_outputs[1]

            # ── CFG guidance ──────────────────────────────────────────
            if do_cfg_guidance:
                pred_cond, pred_null_cond = vt.chunk(2)
                apply_cfg = cfg_interval_start <= t_curr <= cfg_interval_end

                if apply_cfg:
                    if not use_adg:
                        vt = guidance_mod.apg_forward(
                            pred_cond=pred_cond,
                            pred_uncond=pred_null_cond,
                            guidance_scale=diffusion_guidance_sale,
                            momentum_buffer=momentum_buffer,
                            dims=[1],
                        )
                    else:
                        vt = guidance_mod.adg_forward(
                            latents=xt,
                            noise_pred_cond=pred_cond,
                            noise_pred_uncond=pred_null_cond,
                            sigma=t_curr,
                            guidance_scale=diffusion_guidance_sale,
                        )
                else:
                    vt = pred_cond

            # ── Step update ───────────────────────────────────────────
            t_step = t_curr * torch.ones((bsz,), device=device, dtype=dtype)

            # Final step: always compute clean sample directly
            if step_idx == num_steps - 1:
                xt = model.get_x0_from_noise(xt, vt, t_step)
                break

            if infer_method == "sde":
                pred_clean = model.get_x0_from_noise(xt, vt, t_step)
                if config.sde_renoise_linear:
                    # Base/SFT: renoise using unshifted linear timestep
                    next_t = 1.0 - (step_idx + 1) / num_steps
                else:
                    # Turbo variants: renoise using actual schedule value
                    next_t = schedule[step_idx + 1].item()
                xt = model.renoise(pred_clean, next_t)
            elif infer_method == "ode":
                next_t = schedule[step_idx + 1].item()
                dt = t_curr - next_t
                dt_tensor = (
                    dt
                    * torch.ones((bsz,), device=device, dtype=dtype)
                    .unsqueeze(-1)
                    .unsqueeze(-1)
                )
                xt = xt - vt * dt_tensor

    # ── Output ────────────────────────────────────────────────────────
    x_gen = xt
    end_time = time.time()
    time_costs["diffusion_time_cost"] = end_time - start_time
    time_costs["diffusion_per_step_time_cost"] = (
        time_costs["diffusion_time_cost"] / max(num_steps, 1)
    )
    time_costs["total_time_cost"] = end_time - total_start_time

    return {
        "target_latents": x_gen,
        "time_costs": time_costs,
    }
