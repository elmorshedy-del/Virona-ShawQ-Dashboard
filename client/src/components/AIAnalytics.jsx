/**
 * AI ANALYTICS COMPONENT
 * ======================
 * Chat interface for AI-powered analytics with three modes:
 * Ask (quick facts), Analyze (insights), Deep Dive (strategic)
 *
 * INTEGRATED WITH: Meta Awareness feature for reactivation recommendations
 */

import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, Sparkles, Calendar, Brain, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

// Import Meta Awareness feature module
import {
  ReactivationPanel,
  ReactivationBadge,
  REACTIVATION_PROMPTS,
  useReactivationCandidates
} from '../features/meta-awareness';

export default function AIAnalytics({ store, selectedStore, startDate, endDate }) {
  // Support both 'store' and 'selectedStore' props for backward compatibility
  const activeStore = store?.id || selectedStore || 'vironax';

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeMode, setActiveMode] = useState('ask');
  const [insightMode, setInsightMode] = useState('balanced'); // 'instant', 'fast', 'balanced', 'max'
  const [showReactivation, setShowReactivation] = useState(true); // Show reactivation panel
  const messagesEndRef = useRef(null);

  // Use reactivation candidates hook
  const {
    candidates: reactivationCandidates,
    hasCandidates: hasReactivationCandidates,
    summary: reactivationSummary
  } = useReactivationCandidates(activeStore);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Mode configurations with pillars
  // UPDATED: Added reactivation pillars to relevant modes
  const modes = {
    ask: {
      icon: '💬',
      label: 'Ask',
      description: 'Instant lookup and fast facts',
      pillars: [
        { icon: '🌍', label: 'Top country' },
        { icon: '💰', label: 'Revenue' },
        { icon: '🛒', label: 'Orders' },
        { icon: '📣', label: 'Impressions' },
        { icon: '🧺', label: 'ATC' },
        { icon: '🎯', label: 'ROAS' },
        { icon: '🧾', label: 'AOV' }
      ]
    },
    analyze: {
      icon: '📊',
      label: 'Analyze',
      description: 'Performance insights + charts & comparisons',
      pillars: [
        { icon: '📈', label: 'Snapshot' },
        { icon: '🔁', label: 'Period comparison' },
        { icon: '🌍', label: 'Country leaderboard' },
        { icon: '🎯', label: 'Funnel health' },
        { icon: '📣', label: 'Spend vs results' },
        { icon: '🚨', label: 'Anomaly check' },
        { icon: '🧠', label: 'Top drivers' },
        { icon: '🧪', label: 'Creative performance' },
        // NEW: Reactivation pillar
        { icon: '🔄', label: 'Reactivation check' }
      ]
    },
    deepdive: {
      icon: '🧠',
      label: 'Deep Dive',
      description: 'Action plan + optimization',
      pillars: [
        { icon: '🚀', label: 'Scale plan' },
        { icon: '✂️', label: 'Cut plan' },
        { icon: '💸', label: 'Budget reallocation' },
        { icon: '🧱', label: 'Campaign structure' },
        { icon: '🎬', label: 'Creative roadmap' },
        { icon: '🧭', label: 'Audience strategy' },
        { icon: '🧪', label: 'Test plan' },
        { icon: '🛡️', label: 'Risk & efficiency' },
        // NEW: Reactivation pillar
        { icon: '🔄', label: 'Reactivation plan' }
      ]
    }
  };

  // Insight mode options for Deep Dive
  const insightModes = [
    { id: 'instant', label: '✨ Instant', description: 'Quick response' },
    { id: 'fast', label: '⚡ Fast', description: 'Light analysis' },
    { id: 'balanced', label: '⏳ Balanced', description: 'Standard depth' },
    { id: 'max', label: '🧬 Max Insight', description: 'Deep reasoning' }
  ];

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Map frontend modes to backend endpoints
      // 'ask' -> /analyze (quick facts), 'analyze' -> /summarize (insights), 'deepdive' -> /decide (strategic)
      const endpointMap = {
        'ask': '/api/ai/analyze',
        'analyze': '/api/ai/summarize',
        'deepdive': '/api/ai/decide'
      };
      const endpoint = endpointMap[activeMode] || '/api/ai/analyze';

      // Build request body matching backend expected format:
      // Backend expects: { question, store, conversationId, depth }
      const requestBody = {
        question: input,
        store: activeStore
      };

      // Add depth parameter for deepdive mode based on insightMode
      if (activeMode === 'deepdive') {
        const depthMap = {
          'instant': 'instant',
          'fast': 'fast',
          'balanced': 'balanced',
          'max': 'deep'
        };
        requestBody.depth = depthMap[insightMode] || 'balanced';
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      const assistantMessage = {
        role: 'assistant',
        content: data.answer || data.response || data.message || 'No response received',
        timestamp: new Date().toISOString(),
        metadata: {
          mode: activeMode,
          model: data.model,
          reasoning: data.reasoning
        }
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        role: 'assistant',
        content: `Error: ${error.message}. Please try again.`,
        timestamp: new Date().toISOString(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Quick action handler - populates input with a prompt
  // UPDATED: Added reactivation prompts
  const handleQuickAction = (pillar) => {
    const prompts = {
      // Ask mode
      'Top country': 'What is the top performing country by revenue?',
      'Revenue': 'What is the total revenue for this period?',
      'Orders': 'How many orders did we get?',
      'Impressions': 'What are the total impressions?',
      'ATC': 'What is the add to cart count?',
      'ROAS': 'What is our current ROAS?',
      'AOV': 'What is our average order value?',
      // Analyze mode
      'Snapshot': 'Give me a performance snapshot of all key metrics',
      'Period comparison': 'Compare this period to the previous period',
      'Country leaderboard': 'Rank all countries by performance',
      'Funnel health': 'Analyze our funnel conversion rates',
      'Spend vs results': 'How is our spend performing against results?',
      'Anomaly check': 'Are there any anomalies or unusual patterns?',
      'Top drivers': 'What are the top drivers of our performance?',
      'Creative performance': 'How are our creatives performing?',
      // NEW: Reactivation prompts
      'Reactivation check': 'Are there any paused or archived campaigns, ad sets, or ads that I should consider reactivating based on their historical performance?',
      // Deep Dive mode
      'Scale plan': 'Create a scaling plan for our best campaigns',
      'Cut plan': 'What should we cut or pause?',
      'Budget reallocation': 'How should we reallocate our budget?',
      'Campaign structure': 'Analyze and suggest campaign structure improvements',
      'Creative roadmap': 'Create a creative roadmap for the next month',
      'Audience strategy': 'What audience strategy should we pursue?',
      'Test plan': 'Create a testing plan for optimization',
      'Risk & efficiency': 'Identify risks and efficiency opportunities',
      // NEW: Reactivation plan
      'Reactivation plan': 'Create a detailed reactivation plan for the best historical performers. Include which campaigns, ad sets, or ads to turn back on, with budget suggestions and testing approach.'
    };
    setInput(prompts[pillar] || `Tell me about ${pillar}`);
  };

  // Handle reactivation prompt click from panel
  const handleReactivationPromptClick = (promptText) => {
    setInput(promptText);
    // Optionally auto-switch to Deep Dive mode for reactivation questions
    if (activeMode === 'ask') {
      setActiveMode('deepdive');
    }
  };

  const renderMessage = (message, index) => {
    const isUser = message.role === 'user';
    const isError = message.isError;

    return (
      <div
        key={index}
        className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
      >
        <div
          className={`max-w-[85%] rounded-lg p-4 ${
            isUser
              ? 'bg-blue-600 text-white'
              : isError
              ? 'bg-red-50 border border-red-200 text-red-900'
              : 'bg-gray-100 text-gray-900'
          }`}
        >
          <div className="flex items-start gap-2">
            {!isUser && (
              <Sparkles className={`w-5 h-5 mt-0.5 flex-shrink-0 ${isError ? 'text-red-500' : 'text-blue-500'}`} />
            )}
            <div className="flex-1">
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
              {message.metadata && message.metadata.model && (
                <div className="mt-3 pt-3 border-t border-gray-300 text-xs opacity-60">
                  <span>{message.metadata.model}</span>
                  {message.metadata.reasoning && (
                    <span className="ml-2">• {message.metadata.reasoning}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const currentMode = modes[activeMode];

  return (
    <div className="flex h-[calc(100vh-200px)] gap-4">
      {/* Left Sidebar - Mode Selection */}
      <div className="w-72 bg-white rounded-lg shadow-lg p-4 overflow-y-auto">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-500" />
          VironaX AI
          {/* Reactivation badge */}
          {hasReactivationCandidates && (
            <ReactivationBadge count={reactivationSummary.total} className="ml-auto" />
          )}
        </h3>

        {/* Mode Cards */}
        <div className="space-y-3">
          {Object.entries(modes).map(([modeKey, mode]) => (
            <div key={modeKey}>
              <button
                onClick={() => setActiveMode(modeKey)}
                className={`w-full text-left p-3 rounded-lg transition-all ${
                  activeMode === modeKey
                    ? 'bg-blue-50 border-2 border-blue-500'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{mode.icon}</span>
                  <span className="font-medium">{mode.label}</span>
                </div>
                <p className="text-xs text-gray-500 italic">{mode.description}</p>
              </button>

              {/* Pillars - shown when mode is active */}
              {activeMode === modeKey && (
                <div className="mt-2 ml-2 pl-3 border-l-2 border-gray-200">
                  <div className="flex flex-wrap gap-1.5">
                    {mode.pillars.map((pillar, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleQuickAction(pillar.label)}
                        className={`text-xs text-gray-400 italic hover:text-blue-500 hover:bg-blue-50 px-1.5 py-0.5 rounded transition-colors ${
                          pillar.label.includes('Reactivation') ? 'text-orange-400 hover:text-orange-600 hover:bg-orange-50' : ''
                        }`}
                      >
                        {pillar.icon} {pillar.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Deep Dive Insight Toggle - only shown when Deep Dive is selected */}
        {activeMode === 'deepdive' && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-2 font-medium">Insight Depth</p>
            <div className="grid grid-cols-2 gap-1.5">
              {insightModes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setInsightMode(mode.id)}
                  className={`px-2 py-1.5 text-xs rounded-lg transition-all ${
                    insightMode === mode.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2 italic text-center">
              {insightModes.find(m => m.id === insightMode)?.description}
            </p>
          </div>
        )}

        {/* Reactivation Panel - Shows paused/archived campaigns with good performance */}
        {hasReactivationCandidates && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <ReactivationPanel
              store={activeStore}
              onPromptClick={handleReactivationPromptClick}
              collapsed={!showReactivation}
              className="shadow-none border-0 p-0"
            />
          </div>
        )}

        {/* Store Info */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="text-xs text-gray-500">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-3 h-3" />
              <span>Active Store</span>
            </div>
            <div className="ml-5 font-medium text-gray-700">
              {activeStore === 'all' ? 'All Stores' : (activeStore || '').toUpperCase()}
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white rounded-lg shadow-lg">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{currentMode.icon}</span>
              <div>
                <h2 className="text-lg font-semibold">{currentMode.label}</h2>
                <p className="text-xs text-gray-500 italic">{currentMode.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Reactivation indicator in header */}
              {hasReactivationCandidates && (
                <button
                  onClick={() => handleReactivationPromptClick('What are the best reactivation candidates?')}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-50 text-orange-700 text-xs font-medium rounded-lg hover:bg-orange-100 transition-colors"
                  title="Click to ask about reactivation candidates"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{reactivationSummary.total} to reactivate</span>
                </button>
              )}
              {activeMode === 'deepdive' && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-lg">
                  <Brain className="w-4 h-4 text-purple-500" />
                  <span className="text-xs text-purple-700 font-medium">
                    {insightModes.find(m => m.id === insightMode)?.label}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center max-w-md">
                <span className="text-5xl mb-4 block">{currentMode.icon}</span>
                <p className="text-lg font-medium mb-2">{currentMode.label}</p>
                <p className="text-sm text-gray-400 italic mb-6">{currentMode.description}</p>

                {/* Quick Action Buttons */}
                <div className="flex flex-wrap justify-center gap-2">
                  {currentMode.pillars.slice(0, 4).map((pillar, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleQuickAction(pillar.label)}
                      className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-600 rounded-full transition-colors"
                    >
                      {pillar.icon} {pillar.label}
                    </button>
                  ))}
                </div>

                {/* Reactivation quick prompt if candidates exist */}
                {hasReactivationCandidates && (
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <p className="text-xs text-orange-600 font-medium mb-2">🔄 Reactivation Opportunities</p>
                    <button
                      onClick={() => handleReactivationPromptClick('What are the best campaigns, ad sets, or ads I should reactivate based on historical performance?')}
                      className="px-4 py-2 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition-colors"
                    >
                      Analyze {reactivationSummary.total} reactivation candidates
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => renderMessage(message, index))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={`Ask about ${currentMode.label.toLowerCase()}...`}
              className="flex-1 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              disabled={isLoading}
            />
            <button
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
