from pydantic import BaseModel


class TimeDeltaParts(BaseModel):
    days: int
    hours: int
    minutes: int
    seconds: int


class Segment(BaseModel):
    start: TimeDeltaParts
    end: TimeDeltaParts
