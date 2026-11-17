"""Banner shapes (contract for D-067)."""

from pydantic import BaseModel


class BannerOut(BaseModel):
    id: str
    name: str
    # GET /api/v1/banners/{id}/image: the uploaded image, for the owner only.
    image_url: str
    created_at: str


class BannersOut(BaseModel):
    items: list[BannerOut]  # newest first; the caller's own banners only
