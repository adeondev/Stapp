import { memo } from 'react'
import type { UrlPreview } from '../../protocol'
import './linkpreview.css'

interface Props {
  preview: UrlPreview
}

export const LinkPreviewCard = memo(function LinkPreviewCard({ preview }: Props) {
  if (!preview.title && !preview.description) return null

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="stapp-link-preview"
    >
      {preview.image && (
        <div className="stapp-link-preview__image-wrapper">
          <img
            src={preview.image}
            alt={preview.title ?? 'Link preview'}
            loading="lazy"
            className="stapp-link-preview__image"
          />
        </div>
      )}
      <div className="stapp-link-preview__content">
        {preview.site_name && (
          <div className="stapp-link-preview__site">{preview.site_name}</div>
        )}
        {preview.title && (
          <h4 className="stapp-link-preview__title">{preview.title}</h4>
        )}
        {preview.description && (
          <p className="stapp-link-preview__description">{preview.description}</p>
        )}
      </div>
    </a>
  )
})