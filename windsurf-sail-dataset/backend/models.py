"""
Pydantic models for FastAPI requests and responses
"""

from typing import List, Dict, Optional, Literal
from pydantic import BaseModel
from enum import Enum


class PromptType(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"


class ClickPrompt(BaseModel):
    x: int
    y: int
    type: PromptType
    sail_id: Optional[int] = None
    confidence: float = 1.0


class TrackingSegment(BaseModel):
    start_frame: int
    end_frame: int
    click_prompts: List[ClickPrompt]
    skip_frames: Optional[List[int]] = []


class TrackingJobOptions(BaseModel):
    auto_split: bool = True
    max_frames_per_job: int = 100
    memory_target: Literal["t4_safe", "t4_aggressive", "multi_t4"] = "t4_safe"
    overlap_frames: int = 1


class TrackingJobRequest(BaseModel):
    name: str
    segments: List[TrackingSegment]
    options: TrackingJobOptions = TrackingJobOptions()


class SplitJobInfo(BaseModel):
    job_id: str
    name: str
    start_frame: int
    end_frame: int
    frames: int
    click_prompts: List[ClickPrompt] | str  # List for manual, "will_be_propagated" for auto
    prompt_source: Literal["manual", "propagated"]
    estimated_memory: str
    status: Literal["pending", "running", "completed", "failed"] = "pending"


class AutoSplitResult(BaseModel):
    split_required: bool
    estimated_memory: str
    t4_safe: bool
    created_jobs: List[SplitJobInfo]


class TrackingJobResponse(BaseModel):
    job_id: str
    original_request: Dict
    auto_split_result: Optional[AutoSplitResult] = None
    single_job: Optional[SplitJobInfo] = None
    next_steps: Dict


class JobStatus(BaseModel):
    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    progress: Optional[Dict] = None
    memory_usage: Optional[Dict] = None
    results: Optional[Dict] = None
    error: Optional[str] = None


class JobProgress(BaseModel):
    current_frame: int
    total_frames: int
    percentage: float
    estimated_completion: str
    sails_tracked: int


class MemoryUsage(BaseModel):
    current_gpu_memory: str
    peak_memory: str
    t4_utilization: str
    available_memory: str