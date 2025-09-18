from pydantic import BaseModel


class TimeDeltaParts(BaseModel):
    days: int
    hours: int
    minutes: int
    seconds: float


class Segment(BaseModel):
    start: TimeDeltaParts
    end: TimeDeltaParts
