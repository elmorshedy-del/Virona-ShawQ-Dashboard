import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreativeProductionOS from '../CreativeProductionOS';

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
});

const buildFetchMock = () => vi.fn(async (input, init = {}) => {
  const url = String(input || '');
  const method = String(init?.method || 'GET').toUpperCase();

  if (url.includes('/creative-os/catalog')) {
    return jsonResponse({
      success: true,
      products: [
        {
          id: 'p_bad_currency',
          name: 'Contour Abaya',
          price: 130,
          currency: 'AEDD',
          collection: 'new_arrivals',
          angles: 5,
          variants: 3,
          blurb: 'Premium test product',
          image_url: ''
        }
      ],
      integrations: {
        shopify: true,
        salla: true,
        woocommerce: false
      },
      source_stats: {
        order_rows: 1,
        cache_rows: 0,
        profile_rows: 0
      }
    });
  }

  if (url.includes('/creative-os/video/music/library')) {
    return jsonResponse({
      success: true,
      tracks: [
        {
          id: 'uplift_glow',
          title: 'Uplift Glow',
          mood: 'uplift',
          bpm: 124,
          duration: 30,
          license: 'Royalty-free (generated in-app)',
          audio_id: 'lib_uplift_glow',
          audio_ext: 'mp3',
          preview_url: '/api/creative-studio/creative-os/video/audio/download?audio_id=lib_uplift_glow&inline=1'
        }
      ]
    });
  }

  if (url.includes('/creative-os/brand-kit/bootstrap')) {
    return jsonResponse({
      success: true,
      brand_kit: {
        logo_url: 'https://cdn.example.com/logo.png',
        primary_color: '#123456',
        accent_color: '#654321'
      }
    });
  }

  if (url.includes('/creative-os/video/upload') && method === 'POST') {
    return jsonResponse({
      success: true,
      video: {
        video_id: 'video_1',
        ext: 'mp4',
        filename: 'sample.mp4',
        duration: 12.4,
        width: 1080,
        height: 1920
      }
    });
  }

  if (url.includes('/creative-os/video/audio/upload') && method === 'POST') {
    return jsonResponse({
      success: true,
      audio: {
        audio_id: 'audio_1',
        ext: 'mp3',
        filename: 'voice.mp3',
        duration: 4.2
      }
    });
  }

  if (url.includes('/creative-os/video/tts') && method === 'POST') {
    return jsonResponse({
      success: true,
      audio: {
        audio_id: 'tts_1',
        ext: 'mp3',
        filename: 'tts-en.mp3',
        language: 'en'
      }
    });
  }

  if (url.includes('/creative-os/video/beat-grid') && method === 'POST') {
    return jsonResponse({ success: true, beats: [0, 0.5, 1, 1.5, 2] });
  }

  if (url.includes('/creative-os/video/caption-plan') && method === 'POST') {
    return jsonResponse({
      success: true,
      captions: [
        { id: 1, text: 'Premium comfort', start: 0, end: 2 },
        { id: 2, text: 'Shop now', start: 2, end: 3.5 }
      ]
    });
  }

  if (url.includes('/creative-os/video/render') && method === 'POST') {
    return jsonResponse({
      success: true,
      render: {
        download_url: '/api/creative-studio/creative-os/video/download?output_id=render_1',
        captions_count: 2,
        timeline_duration_seconds: 12.4
      }
    });
  }

  if (url.includes('/creative-os/export/batch') && method === 'POST') {
    return jsonResponse({
      success: true,
      assets: [
        {
          asset_id: 'asset_1',
          file_name: 'contour-abaya_meta_launch-a.png',
          download_url: '/api/creative-studio/creative-os/export/download?asset_id=asset_1'
        }
      ]
    });
  }

  if (url.includes('/templates') && method === 'POST') {
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: true });
});

describe('CreativeProductionOS', () => {
  beforeEach(() => {
    global.fetch = buildFetchMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps Product Hub standalone and modules separated', async () => {
    render(<CreativeProductionOS store="vironax" />);

    expect(await screen.findByText('Product Hub')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Workspace Modules/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Design Studio/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Video Studio/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Multi-Format Engine/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('$130.00').length).toBeGreaterThan(0);
    });
  });

  it('switches modules and uploads timeline source video', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreativeProductionOS store="vironax" />);

    await user.click(screen.getByRole('button', { name: /Video Studio/i }));
    expect(await screen.findByText(/Timeline Source Video/i)).toBeInTheDocument();

    const videoInput = container.querySelector('input[type="file"][accept="video/*"]');
    expect(videoInput).toBeTruthy();

    const videoFile = new File(['video-bytes'], 'sample.mp4', { type: 'video/mp4' });
    fireEvent.change(videoInput, { target: { files: [videoFile] } });

    expect(await screen.findByText(/Uploaded: sample\.mp4/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/creative-os/video/upload'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('extracts brand logo into Brand Kit and updates colors', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreativeProductionOS store="vironax" />);

    await user.click(screen.getByRole('button', { name: /Extract Logo/i }));

    expect(await screen.findByAltText('Brand kit logo')).toHaveAttribute('src', 'https://cdn.example.com/logo.png');

    const colorInputs = container.querySelectorAll('input[type="color"]');
    expect(colorInputs.length).toBeGreaterThan(1);
    expect(colorInputs[0].value.toLowerCase()).toBe('#123456');
    expect(colorInputs[1].value.toLowerCase()).toBe('#654321');
  });

  it('runs full video workflow and renders caption burn-in export', async () => {
    const user = userEvent.setup();
    const { container } = render(<CreativeProductionOS store="vironax" />);

    await user.click(screen.getByRole('button', { name: /Video Studio/i }));
    expect(await screen.findByText(/Timeline Source Video/i)).toBeInTheDocument();

    const videoInput = container.querySelector('input[type="file"][accept="video/*"]');
    expect(videoInput).toBeTruthy();
    const videoFile = new File(['video-bytes'], 'timeline-source.mp4', { type: 'video/mp4' });
    fireEvent.change(videoInput, { target: { files: [videoFile] } });
    expect(await screen.findByText(/Uploaded: sample\.mp4/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Generate Beat Grid/i }));
    expect(await screen.findByText(/Beats: 0s, 0.5s, 1s, 1.5s, 2s/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Generate Caption Plan/i }));
    expect(await screen.findByText(/Caption Timeline/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Premium comfort/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Generate AI Voice/i }));
    expect(await screen.findByText(/Voice track: tts-en\.mp3/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Render Caption Burn-in Video/i }));
    expect(await screen.findByRole('link', { name: /Download Rendered Video/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/creative-os/video/render'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('exports multi-format creative pack and saves workspace preset', async () => {
    const user = userEvent.setup();
    render(<CreativeProductionOS store="vironax" />);

    await user.click(screen.getByRole('button', { name: /Multi-Format Engine/i }));
    expect(await screen.findByText(/Batch Export Targets/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Render Creative Pack/i }));
    expect(await screen.findByText(/Rendered Assets/i)).toBeInTheDocument();
    expect(screen.getAllByText(/contour-abaya_meta_launch-a\.png/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Save Workspace Preset/i }));
    expect(await screen.findByText(/Workspace preset saved\./i)).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/creative-os/export/batch'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/creative-studio/templates'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('routes Product Hub actions into design and video modules without step coupling', async () => {
    const user = userEvent.setup();
    render(<CreativeProductionOS store="vironax" />);

    await user.click(screen.getByRole('button', { name: /Use In Video/i }));
    expect(await screen.findByText(/Timeline Source Video/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Use In Design/i }));
    expect(await screen.findByText(/Live Canvas Preview/i)).toBeInTheDocument();
  });
});
