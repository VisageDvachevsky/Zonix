from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(min_length=1)
    app: str = Field(min_length=1)
    version: str = Field(min_length=1)
    environment: str = Field(min_length=1)


class ReadinessResponse(BaseModel):
    status: str = Field(min_length=1)
    database: str = Field(min_length=1)
