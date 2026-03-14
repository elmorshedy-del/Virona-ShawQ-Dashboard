from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Product(BaseModel):
    name: str
    description: str = ""
    category: str = ""
    price: float | None = None
    tags: list[str] = Field(default_factory=list)
    image_alt: str = ""


class StoreProfile(BaseModel):
    url: str
    platform: str
    language: str
    market: str
    positioning: str
    products: list[Product] = Field(default_factory=list)


class CreativeDNAPaletteColor(BaseModel):
    id: str
    name: str
    hex: str
    role: Literal["primary", "secondary", "accent", "neutral", "support"]


class CreativeDNALook(BaseModel):
    id: str
    name: str
    description: str
    background_prompt: str = ""
    shadow_style: Literal["soft", "studio", "dramatic"] = "soft"
    tone_tags: list[str] = Field(default_factory=list)


class CreativeDNAExportPreset(BaseModel):
    id: str
    name: str
    width_px: int
    height_px: int
    use_case: str


class CreativeDNAMark(BaseModel):
    id: str
    name: str
    kind: Literal["logo", "badge", "patch", "mark", "vector_art"] = "mark"
    file_format: Literal["svg"] = "svg"
    source_name: str = ""
    svg: str
    created_at: str


class CreativeDNASavedWork(BaseModel):
    id: str
    title: str
    work_type: Literal["profile_refresh", "vectorization"] = "profile_refresh"
    description: str = ""
    linked_mark_id: str | None = None
    created_at: str


class CreativeDNAProfile(BaseModel):
    tenant_key: str = "default"
    store_key: str
    store_url: str
    brand_name: str
    summary: str = ""
    tone_keywords: list[str] = Field(default_factory=list)
    photography_direction: str = ""
    palette: list[CreativeDNAPaletteColor] = Field(default_factory=list)
    looks: list[CreativeDNALook] = Field(default_factory=list)
    export_presets: list[CreativeDNAExportPreset] = Field(default_factory=list)
    marks: list[CreativeDNAMark] = Field(default_factory=list)
    saved_works: list[CreativeDNASavedWork] = Field(default_factory=list)
    source_profile: StoreProfile | None = None
    updated_at: str


class CreativeDNAVectorizationResult(BaseModel):
    profile: CreativeDNAProfile
    mark: CreativeDNAMark
