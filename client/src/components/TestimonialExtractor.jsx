import React, { useState } from 'react';
import {
  Upload, Sparkles, Download, Copy, Trash2, Plus,
  ChevronDown, ChevronUp, Loader2, AlertCircle, CheckCircle2, X
} from 'lucide-react';

const PRESETS = [
  { key: 'instagram_story', label: 'Instagram Story', dimensions: '1080x1920' },
  { key: 'instagram_post', label: 'Instagram Post', dimensions: '1080x1080' },
  { key: 'twitter', label: 'Twitter/X', dimensions: '1200x675' },
  { key: 'linkedin', label: 'LinkedIn', dimensions: '1200x627' },
  { key: 'website', label: 'Website', dimensions: 'Auto-fit' },
  { key: 'presentation', label: 'Presentation', dimensions: '1920x1080' },
  { key: 'raw_bubbles', label: 'Raw Bubbles', dimensions: 'Auto-fit' }
];

const BUBBLE_STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'soft_shadow', label: 'Soft Shadow' },
  { value: 'hard_shadow', label: 'Hard Shadow' },
  { value: 'outline', label: 'Outline' }
];

const OUTPUT_SHAPES = [
  { value: 'bubble', label: 'Chat Bubble', description: 'Rounded rectangle chat bubble' },
  { value: 'quote_card', label: 'Quote Card', description: 'Large quotation marks with centered text' },
  { value: 'card', label: 'Card', description: 'Rectangle with subtle border' },
  { value: 'minimal', label: 'Minimal', description: 'Just text on background' }
];

const LOGO_POSITIONS = [
  { value: 'bottom_right', label: 'Bottom Right' },
  { value: 'bottom_left', label: 'Bottom Left' },
  { value: 'top_right', label: 'Top Right' },
  { value: 'top_left', label: 'Top Left' }
];

export default function TestimonialExtractor() {
  // Phase 1: Extraction state
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');

  // Phase 2: Messages state
  const [messages, setMessages] = useState([]);
  const [newMessageText, setNewMessageText] = useState('');

  // Phase 3: Styling state
  const [preset, setPreset] = useState('instagram_post');
  const [layout, setLayout] = useState('stacked');
  const [collageColumns, setCollageColumns] = useState(2);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Advanced options
  const [backgroundType, setBackgroundType] = useState('solid');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [gradientColor1, setGradientColor1] = useState('#833ab4');
  const [gradientColor2, setGradientColor2] = useState('#fcb045');
  const [outputShape, setOutputShape] = useState('bubble');
  const [borderRadius, setBorderRadius] = useState(20);
  const [bubbleStyle, setBubbleStyle] = useState('soft_shadow');
  const [bubbleColor, setBubbleColor] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#000000');
  const [fontSize, setFontSize] = useState(28);
  const [typographyPreset, setTypographyPreset] = useState('inherit');
  const [quoteTreatment, setQuoteTreatment] = useState('polished');
  const [weightOption, setWeightOption] = useState('match');
  const [cardPadding, setCardPadding] = useState('m');
  const [lineSpacing, setLineSpacing] = useState('normal');
  const [maxWidth, setMaxWidth] = useState('standard');

  // Output state
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState(null);
  const [generateError, setGenerateError] = useState('');
  const [generateSuccess, setGenerateSuccess] = useState('');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugEvents, setDebugEvents] = useState([]);
  const [lastExtractResponse, setLastExtractResponse] = useState(null);
  const [lastGenerateResponse, setLastGenerateResponse] = useState(null);

  const addDebugEvent = (event) => {
    setDebugEvents(prev => ([
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toLocaleTimeString(),
        ...event
      },
      ...prev
    ].slice(0, 20)));
  };

  // File upload handler
  const handleFileChange = (e) => {
    const incomingFiles = Array.from(e.target.files);
    if (incomingFiles.length === 0) {
      return;
    }

    const mergedFiles = [...uploadedFiles, ...incomingFiles].slice(0, 10);
    if (uploadedFiles.length + incomingFiles.length > 10) {
      setUploadError('You can upload up to 10 screenshots. Extra files were ignored.');
    } else {
      setUploadError('');
    }

    setUploadedFiles(mergedFiles);
    if (mergedFiles.length < 2) {
      setLayout('stacked');
    }
    setExtractError('');
    setMessages([]);
    setGeneratedImage(null);
    addDebugEvent({
      step: 'Upload',
      status: 'updated',
      detail: `${mergedFiles.length} file(s) ready`
    });
  };

  // Extract messages from screenshots
  const handleExtract = async () => {
    if (uploadedFiles.length === 0) {
      setExtractError('Please upload at least one screenshot');
      return;
    }

    setExtracting(true);
    setExtractError('');
    setMessages([]);
    setLastExtractResponse(null);
    addDebugEvent({ step: 'Extract', status: 'started', detail: 'Submitting screenshots to API' });

    try {
      const formData = new FormData();
     uploadedFiles.forEach((file, index) => {
  // This will tell us if the file has data (bytes) or is empty
     console.log(`File ${index}: ${file.name}, Size: ${file.size} bytes`);
     formData.append('screenshots', file);
});

      const response = await fetch('/api/testimonials/extract', {
        method: 'POST',
        body: formData
      });
      const status = response.status;

      const data = await response.json();

      if (!response.ok) {
        if (data.errorCode === 'INSUFFICIENT_FUNDS') {
          addDebugEvent({ step: 'Extract', status: `error (${status})`, detail: 'Insufficient funds' });
          throw new Error('Insufficient funds to analyze the screenshot. Please top up and try again.');
        }
        addDebugEvent({ step: 'Extract', status: `error (${status})`, detail: data.error || 'Extraction failed' });
        throw new Error(data.error || 'Failed to extract messages');
      }

      const normalizedMessages = (data.messages || []).map((msg, index) => ({
        text: msg.text || msg.quoteText || '',
        quoteText: msg.quoteText || msg.text || '',
        side: msg.side === 'right' ? 'right' : 'left',
        order: msg.order || index + 1,
        authorName: msg.authorName || '',
        authorRole: msg.authorRole || '',
        avatarPresent: Boolean(msg.avatarPresent),
        avatarShape: msg.avatarShape || null,
        avatarBox: msg.avatarBox || null,
        avatarPlacementPct: msg.avatarPlacementPct || null,
        avatarDataUrl: msg.avatarDataUrl || null
      }));
      setMessages(normalizedMessages);
      if (normalizedMessages.length < 2) {
        setLayout('stacked');
      }
      setLastExtractResponse({
        status,
        ...data
      });
      addDebugEvent({
        step: 'Extract',
        status: 'success',
        detail: `${normalizedMessages.length} message(s) extracted`
      });
      setExtractError('');
    } catch (error) {
      console.error('Extract error:', error);
      setExtractError(error.message);
      setLastExtractResponse({ error: error.message });
      setMessages([]);
    } finally {
      setExtracting(false);
    }
  };

  // Update message text
  const updateMessage = (index, newText) => {
    const updated = [...messages];
    updated[index] = {
      ...updated[index],
      text: newText,
      quoteText: newText
    };
    setMessages(updated);
  };

  // Delete message
  const deleteMessage = (index) => {
    const updated = messages.filter((_, i) => i !== index);
    setMessages(updated);
    if (updated.length < 2) {
      setLayout('stacked');
    }
  };

  // Add new message
  const addMessage = () => {
    if (!newMessageText.trim()) return;

    const newMsg = {
      text: newMessageText,
      quoteText: newMessageText,
      authorName: '',
      authorRole: '',
      avatarPresent: false,
      avatarShape: null,
      avatarBox: null,
      avatarPlacementPct: null,
      avatarDataUrl: null,
      side: 'left',
      order: messages.length + 1
    };

    setMessages([...messages, newMsg]);
    setNewMessageText('');
  };

  // Toggle message side (left/right)
  const toggleSide = (index) => {
    const updated = [...messages];
    updated[index].side = updated[index].side === 'left' ? 'right' : 'left';
    setMessages(updated);
  };

  const updateAuthorField = (index, field, value) => {
    const updated = [...messages];
    updated[index] = {
      ...updated[index],
      [field]: value
    };
    setMessages(updated);
  };

  const removeUploadedFile = (index) => {
    const updatedFiles = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(updatedFiles);
    setUploadError('');
    if (updatedFiles.length < 2) {
      setLayout('stacked');
    }
    if (updatedFiles.length === 0) {
      setMessages([]);
      setGeneratedImage(null);
    }
  };

  // Generate testimonial
  const handleGenerate = async () => {
    if (messages.length === 0) {
      setGenerateError('No messages to render. Please extract or add messages first.');
      return;
    }

    setGenerating(true);
    setGenerateError('');
    setGenerateSuccess('');
    setLastGenerateResponse(null);
    addDebugEvent({ step: 'Generate', status: 'started', detail: 'Rendering testimonial image' });

    try {
      const payload = {
        messages,
        preset,
        layout,
        collageColumns,
        outputShape,
        borderRadius,
        bubbleStyle,
        bubbleColor,
        textColor,
        fontSize,
        typographyPreset,
        quoteTreatment,
        weightOption,
        cardPadding,
        lineSpacing,
        maxWidth
      };

      // Add background options
      if (backgroundType === 'transparent') {
        payload.backgroundType = 'transparent';
      } else if (backgroundType === 'gradient') {
        payload.backgroundType = 'gradient';
        payload.gradientColors = [gradientColor1, gradientColor2];
      } else if (backgroundType === 'custom') {
        payload.backgroundType = 'solid';
        payload.backgroundColor = backgroundColor;
      }

      const response = await fetch('/api/testimonials/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const status = response.status;

      const data = await response.json();

      if (!response.ok) {
        addDebugEvent({ step: 'Generate', status: `error (${status})`, detail: data.error || 'Generation failed' });
        throw new Error(data.error || 'Failed to generate testimonial');
      }

      setGeneratedImage(data.image);
      setGenerateSuccess('✨ Testimonial generated successfully!');
      setLastGenerateResponse({
        status,
        ...data
      });
      addDebugEvent({ step: 'Generate', status: 'success', detail: 'Image ready for preview' });
    } catch (error) {
      console.error('Generate error:', error);
      setGenerateError(error.message);
      setLastGenerateResponse({ error: error.message });
    } finally {
      setGenerating(false);
    }
  };

  // Download image
  const handleDownload = () => {
    if (!generatedImage) return;

    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `testimonial-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy to clipboard
  const handleCopyToClipboard = async () => {
    if (!generatedImage) return;

    try {
      const blob = await (await fetch(generatedImage)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      alert('Image copied to clipboard!');
    } catch (error) {
      console.error('Copy error:', error);
      alert('Failed to copy to clipboard. Please use the download button instead.');
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="text-purple-600" size={28} />
            Testimonial Extractor
          </h2>
          <p className="text-gray-600 mt-2">
            Turn messy chat screenshots into beautiful, branded testimonial images
          </p>
        </div>

        {/* Phase 1: Upload & Extract */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Step 1: Upload Screenshots
          </h3>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-purple-400 transition-colors">
            <Upload className="mx-auto text-gray-400 mb-4" size={48} />
            <label className="cursor-pointer">
              <span className="text-purple-600 hover:text-purple-700 font-medium">
                Click to upload
              </span>
              <span className="text-gray-600"> or drag and drop</span>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
            <p className="text-sm text-gray-500 mt-2">
              PNG, JPG, WebP (up to 10 files)
            </p>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-gray-600 mb-2">
                {uploadedFiles.length} file(s) selected
              </p>
              <button
                type="button"
                onClick={() => {
                  setUploadedFiles([]);
                  setMessages([]);
                  setGeneratedImage(null);
                  setUploadError('');
                  addDebugEvent({ step: 'Upload', status: 'cleared', detail: 'All uploads removed' });
                }}
                className="mb-3 text-xs text-gray-500 hover:text-gray-700"
              >
                Clear all uploads
              </button>
              <div className="flex flex-wrap gap-2">
                {uploadedFiles.map((file, i) => (
                  <span
                    key={`${file.name}-${i}`}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                  >
                    {file.name}
                    <button
                      type="button"
                      onClick={() => removeUploadedFile(i)}
                      className="text-purple-500 hover:text-purple-700"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {uploadError && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              {uploadError}
            </div>
          )}

          <button
            onClick={handleExtract}
            disabled={extracting || uploadedFiles.length === 0}
            className="mt-4 w-full bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 font-medium"
          >
            {extracting ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Extracting...
              </>
            ) : (
              <>
                <Sparkles size={20} />
                Extract Text
              </>
            )}
          </button>

          {extractError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <p className="text-red-700 text-sm">{extractError}</p>
            </div>
          )}
        </div>

        {/* Phase 2: Edit Messages */}
        {messages.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Step 2: Review & Edit Messages
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Edit the extracted text below. Fix any mistakes before generating.
            </p>

            <div className="space-y-4">
              {messages.map((msg, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <textarea
                        value={msg.text}
                        onChange={(e) => updateMessage(index, e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                        rows={2}
                      />
                      <button
                        onClick={() => toggleSide(index)}
                        className="absolute bottom-2 right-2 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
                      >
                        {msg.side === 'left' ? '← Left' : 'Right →'}
                      </button>
                    </div>
                    <button
                      onClick={() => deleteMessage(index)}
                      className="p-3 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Author name (optional)"
                      value={msg.authorName || ''}
                      onChange={(e) => updateAuthorField(index, 'authorName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <input
                      type="text"
                      placeholder="Author role (optional)"
                      value={msg.authorRole || ''}
                      onChange={(e) => updateAuthorField(index, 'authorRole', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  {msg.avatarPresent && (
                    <p className="mt-2 text-xs text-gray-500">
                      Avatar detected and will be placed automatically during rendering.
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                type="text"
                placeholder="Add new message manually..."
                value={newMessageText}
                onChange={(e) => setNewMessageText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addMessage()}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <button
                onClick={addMessage}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors flex items-center gap-2"
              >
                <Plus size={20} />
                Add
              </button>
            </div>
          </div>
        )}

        {/* Phase 3: Style & Generate */}
        {messages.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Step 3: Choose Style
            </h3>

            {/* Preset Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Output Preset
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPreset(p.key)}
                    className={`p-3 border-2 rounded-lg text-left transition-all ${
                      preset === p.key
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-gray-900">{p.label}</div>
                    <div className="text-xs text-gray-500 mt-1">{p.dimensions}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Layout Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Layout
              </label>
              <div className={`flex gap-3 ${messages.length < 2 ? 'opacity-50 pointer-events-none' : ''}`}>
                <button
                  onClick={() => setLayout('stacked')}
                  className={`flex-1 p-3 border-2 rounded-lg transition-all ${
                    layout === 'stacked'
                      ? 'border-purple-600 bg-purple-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-gray-900">Stacked</div>
                  <div className="text-xs text-gray-500 mt-1">Vertical bubbles</div>
                </button>
                <button
                  onClick={() => setLayout('collage')}
                  className={`flex-1 p-3 border-2 rounded-lg transition-all ${
                    layout === 'collage'
                      ? 'border-purple-600 bg-purple-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-gray-900">Collage Grid</div>
                  <div className="text-xs text-gray-500 mt-1">Multi-column</div>
                </button>
              </div>
              {messages.length < 2 && (
                <p className="mt-2 text-xs text-gray-500">
                  Layout options unlock when two or more messages are available.
                </p>
              )}

              {layout === 'collage' && (
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Columns: {collageColumns}
                  </label>
                  <input
                    type="range"
                    min="2"
                    max="4"
                    value={collageColumns}
                    onChange={(e) => setCollageColumns(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            {/* Advanced Options */}
            <div className="mb-6">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-purple-600 hover:text-purple-700 font-medium"
              >
                {showAdvanced ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                Advanced Options
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                  {/* Background Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Background
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {['solid', 'transparent', 'custom', 'gradient'].map(type => (
                        <button
                          key={type}
                          onClick={() => setBackgroundType(type)}
                          className={`px-3 py-2 border rounded-lg text-sm capitalize ${
                            backgroundType === type
                              ? 'border-purple-600 bg-purple-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          {type === 'solid' ? 'White' : type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color Pickers */}
                  {backgroundType === 'custom' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Background Color
                      </label>
                      <input
                        type="color"
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="h-10 w-full rounded border border-gray-300"
                      />
                    </div>
                  )}

                  {backgroundType === 'gradient' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Gradient Start
                        </label>
                        <input
                          type="color"
                          value={gradientColor1}
                          onChange={(e) => setGradientColor1(e.target.value)}
                          className="h-10 w-full rounded border border-gray-300"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Gradient End
                        </label>
                        <input
                          type="color"
                          value={gradientColor2}
                          onChange={(e) => setGradientColor2(e.target.value)}
                          className="h-10 w-full rounded border border-gray-300"
                        />
                      </div>
                    </div>
                  )}

                  {/* Output Shape */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Output Shape
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {OUTPUT_SHAPES.map(shape => (
                        <button
                          key={shape.value}
                          onClick={() => setOutputShape(shape.value)}
                          className={`p-3 border-2 rounded-lg text-left transition-all ${
                            outputShape === shape.value
                              ? 'border-purple-600 bg-purple-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <div className="font-medium text-sm text-gray-900">{shape.label}</div>
                          <div className="text-xs text-gray-500 mt-1">{shape.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Border Radius */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Border Radius: {borderRadius}px {outputShape === 'minimal' && '(disabled for minimal)'}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      value={borderRadius}
                      onChange={(e) => setBorderRadius(parseInt(e.target.value))}
                      disabled={outputShape === 'minimal'}
                      className="w-full disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/* Bubble Style */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bubble Style
                    </label>
                    <select
                      value={bubbleStyle}
                      onChange={(e) => setBubbleStyle(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    >
                      {BUBBLE_STYLES.map(style => (
                        <option key={style.value} value={style.value}>
                          {style.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Colors */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Bubble Color
                      </label>
                      <input
                        type="color"
                        value={bubbleColor}
                        onChange={(e) => setBubbleColor(e.target.value)}
                        className="h-10 w-full rounded border border-gray-300"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Text Color
                      </label>
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="h-10 w-full rounded border border-gray-300"
                      />
                    </div>
                  </div>

                  {/* Font Size */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Font Size: {fontSize}px
                    </label>
                    <input
                      type="range"
                      min="16"
                      max="48"
                      value={fontSize}
                      onChange={(e) => setFontSize(parseInt(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  {/* Typography */}
                  <div className="pt-2 border-t border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-800 mb-3">
                      Typography
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Typography Preset
                        </label>
                        <select
                          value={typographyPreset}
                          onChange={(e) => setTypographyPreset(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="inherit">Inherit (Site Default)</option>
                          <option value="editorial">Editorial</option>
                          <option value="compact">Compact</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Quote Treatment
                        </label>
                        <select
                          value={quoteTreatment}
                          onChange={(e) => setQuoteTreatment(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="polished">Polished</option>
                          <option value="editorial">Editorial Quotes</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Weight
                        </label>
                        <select
                          value={weightOption}
                          onChange={(e) => setWeightOption(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="match">Match body weight</option>
                          <option value="medium">Medium</option>
                          <option value="bold">Bold</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Card Padding
                        </label>
                        <select
                          value={cardPadding}
                          onChange={(e) => setCardPadding(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="s">S</option>
                          <option value="m">M</option>
                          <option value="l">L</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Line Spacing
                        </label>
                        <select
                          value={lineSpacing}
                          onChange={(e) => setLineSpacing(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="normal">Normal</option>
                          <option value="relaxed">Relaxed</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Max Width
                        </label>
                        <select
                          value={maxWidth}
                          onChange={(e) => setMaxWidth(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="narrow">Narrow</option>
                          <option value="standard">Standard</option>
                          <option value="wide">Wide</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-4 rounded-lg hover:from-purple-700 hover:to-pink-700 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 font-semibold text-lg shadow-lg"
            >
              {generating ? (
                <>
                  <Loader2 className="animate-spin" size={24} />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles size={24} />
                  Generate Testimonial
                </>
              )}
            </button>

            {generateError && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
                <p className="text-red-700 text-sm">{generateError}</p>
              </div>
            )}

            {generateSuccess && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
                <CheckCircle2 className="text-green-600 flex-shrink-0 mt-0.5" size={20} />
                <p className="text-green-700 text-sm">{generateSuccess}</p>
              </div>
            )}
          </div>
        )}

        {/* Output Preview */}
        {generatedImage && (
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Preview & Download
            </h3>

            <div className="bg-gray-100 rounded-lg p-4 mb-4">
              <img
                src={generatedImage}
                alt="Generated testimonial"
                className="max-w-full mx-auto rounded shadow-lg"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 font-medium"
              >
                <Download size={20} />
                Download PNG
              </button>
              <button
                onClick={handleCopyToClipboard}
                className="flex-1 bg-gray-100 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2 font-medium"
              >
                <Copy size={20} />
                Copy to Clipboard
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <button
            type="button"
            onClick={() => setShowDebugPanel(!showDebugPanel)}
            className="flex items-center gap-2 text-purple-600 hover:text-purple-700 font-medium"
          >
            {showDebugPanel ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            Debug Panel
          </button>

          {showDebugPanel && (
            <div className="mt-4 space-y-4 text-sm text-gray-700">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs uppercase text-gray-500">Uploads</div>
                  <div className="font-semibold">{uploadedFiles.length}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs uppercase text-gray-500">Messages</div>
                  <div className="font-semibold">{messages.length}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs uppercase text-gray-500">Layout</div>
                  <div className="font-semibold">{layout}</div>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase text-gray-500 mb-2">Pipeline events</div>
                <ul className="space-y-2">
                  {debugEvents.length === 0 && (
                    <li className="text-gray-500">No events yet.</li>
                  )}
                  {debugEvents.map(event => (
                    <li key={event.id} className="flex items-start gap-2">
                      <span className="text-gray-400">{event.timestamp}</span>
                      <span className="font-semibold">{event.step}</span>
                      <span className="text-gray-600">{event.status}</span>
                      <span className="text-gray-500">{event.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase text-gray-500 mb-2">Last extract response</div>
                  <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap">
                    {lastExtractResponse ? JSON.stringify(lastExtractResponse, null, 2) : 'No extract run yet.'}
                  </pre>
                </div>
                <div>
                  <div className="text-xs uppercase text-gray-500 mb-2">Last generate response</div>
                  <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap">
                    {lastGenerateResponse ? JSON.stringify(lastGenerateResponse, null, 2) : 'No generate run yet.'}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
