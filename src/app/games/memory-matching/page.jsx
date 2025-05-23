"use client";
import React, {useCallback, useEffect, useRef, useState} from 'react';
import "../../globals.css";

// --- Constants ---
const GRID_ROWS = 2;
const GRID_COLS = 4;
const CARD_COUNT = GRID_ROWS * GRID_COLS;
const BOARD_DETECT_WIDTH = 400; // Must match backend
const BOARD_DETECT_HEIGHT = 200; // Must match backend

// Map backend names to Tailwind colors or hex codes
// Use Tailwind classes for better consistency if possible (e.g., 'bg-red-500')
// Using hex codes here for flexibility with specific shades.
const colorMap = {
    red: '#ef4444',    // Tailwind red-500
    yellow: '#facc15', // Tailwind yellow-400
    green: '#22c55e',  // Tailwind green-500
    blue: '#3b82f6',   // Tailwind blue-500
    orange: '#f97316', // Tailwind orange-500
    apple: '#dc2626',  // Tailwind red-600
    cat: '#a855f7',    // Tailwind purple-500
    car: '#06b6d4',    // Tailwind cyan-500
    umbrella: '#16a34a',// Tailwind green-600
    banana: '#fde047', // Tailwind yellow-300
    'fire hydrant': '#e11d48', // Tailwind rose-600
    person: '#78716c', // Tailwind stone-500
    'detect_fail': '#6b7280', // Tailwind gray-500
    'default_flipped': '#d1d5db', // Tailwind gray-300
};

export default function MemoryGame() {
    const [gameVersion, setGameVersion] = useState(null); // 'color', 'yolo', or null
    const [isConnected, setIsConnected] = useState(false);
    const [videoSrc, setVideoSrc] = useState('');
    const [transformedVideoSrc, setTransformedVideoSrc] = useState('');
    const [gameState, setGameState] = useState(null); // Holds card_states, pairs_found, current_flipped
    const [message, setMessage] = useState('Select game version to start.');
    const [lastMessageTime, setLastMessageTime] = useState(0); // Throttle rapid messages
    const [isGameOver, setIsGameOver] = useState(false);
    const [showError, setShowError] = useState(null); // Display errors prominently
    const websocket = useRef(null);

    // Debounced message update
    const updateMessage = useCallback((newMessage, isError = false) => {
        const now = Date.now();
        // Update immediately for errors or if enough time has passed
        if (isError || now - lastMessageTime > 300) {
            setMessage(newMessage);
            setLastMessageTime(now);
            if (isError) {
                setShowError(newMessage);
                // Auto-hide error after some time
                setTimeout(() => setShowError(null), 5000);
            } else {
                setShowError(null); // Clear previous error on normal message
            }
        }
    }, [lastMessageTime]);


    const connectWebSocket = useCallback((version) => {
        if (websocket.current) {
            websocket.current.close();
        }
        setMessage(`Connecting to ${version} game...`);
        setIsGameOver(false);
        setGameState(null); // Reset game state on new connection attempt
        setVideoSrc('');
        setTransformedVideoSrc('');


        // Adjust protocol and hostname/port as needed
        const wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
        const wsUrl = `${wsProtocol}${window.location.hostname}:8000/ws/${version}`; // Use centralized endpoint
        console.log(`Attempting to connect to: ${wsUrl}`);
        websocket.current = new WebSocket(wsUrl);

        websocket.current.onopen = () => {
            console.log('WebSocket Connected');
            setIsConnected(true);
            setMessage(`${version.charAt(0).toUpperCase() + version.slice(1)} game connected. Waiting for start...`);
            // Send config message to select mode
            websocket.current.send(JSON.stringify({mode: version}));
        };

        websocket.current.onclose = (event) => {
            console.log(`WebSocket Disconnected: Code=${event.code}, Reason=${event.reason}`);
            setIsConnected(false);
            setVideoSrc('');
            setTransformedVideoSrc('');
            setGameState(null);
            if (!isGameOver) {
                setMessage(`Disconnected (${event.code}). Select game version to reconnect.`);
                setGameVersion(null); // Allow re-selection only if not game over
            } else {
                setMessage(`Game Over! Disconnected. Select version to play again.`);
                // Keep gameVersion set so UI doesn't disappear? Or clear it? Let's clear.
                // setGameVersion(null);
            }
            websocket.current = null;
        };

        websocket.current.onerror = (error) => {
            console.error('WebSocket Error:', error);
            // Try to get more specific error info if possible
            const errorMsg = error.message || (error.target?.url ? `Failed to connect to ${error.target.url}` : 'Connection failed.');
            setMessage(`WebSocket Error: ${errorMsg}`);
            setIsConnected(false);
            setVideoSrc('');
            setTransformedVideoSrc('');
            setGameState(null);
            setGameVersion(null); // Allow re-selection on error
            websocket.current = null;
        };

        websocket.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // console.log("WS Message Type:", data.type); // Debug

                switch (data.type) {
                    // Combined frame update message
                    case 'frame_update':
                        if (data.payload?.frame) {
                            setVideoSrc(`data:image/jpeg;base64,${data.payload.frame}`);
                        }
                        if (data.payload?.transformed_frame) {
                            setTransformedVideoSrc(`data:image/jpeg;base64,${data.payload.transformed_frame}`);
                        } else {
                            // Explicitly clear if not sent, e.g., if board detection fails
                            // setTransformedVideoSrc('');
                        }
                        break;
                    case 'game_state':
                        console.log("Game State Update:", data.payload);
                        // Expecting payload: { card_states: {...}, pairs_found: X, current_flipped: [...] }
                        if (data.payload && typeof data.payload === 'object' && data.payload.card_states) {
                            // Update the whole game state object
                            setGameState(prevState => ({...prevState, ...data.payload}));
                        } else {
                            console.warn("Received game_state with unexpected structure:", data.payload)
                        }
                        break;
                    case 'arm_status':
                        console.log("Arm Status:", data.payload);
                        setMessage(`Arm: ${data.payload?.action} ${data.payload?.success ? 'OK ✅' : 'Failed ❌'}`);
                        // Optionally highlight card briefly on action?
                        break;
                    case 'cards_hidden':
                        // This might not be needed if game_state updates handle the visual change correctly
                        console.log("Cards hidden:", data.payload);
                        setMessage(`Cards ${data.payload.join(' & ')} returned.`);
                        // Trigger short visual cue? Or rely on game_state removing them from current_flipped?
                        break;
                    case 'message':
                        console.log("Message:", data.payload);
                        setMessage(data.payload);
                        break;
                    case 'game_over':
                        console.log("Game Over:", data.payload);
                        setMessage(`Game Over! ${data.payload}`);
                        setIsGameOver(true);
                        // Optional: Close WS after timeout?
                        // setTimeout(() => websocket.current?.close(), 5000);
                        break;
                    case 'error':
                        console.error('Game Error from Server:', data.payload);
                        setMessage(`Error: ${data.payload}`);
                        // Decide if error is fatal
                        if (data.payload.includes("Failed to initialize serial port") || data.payload.includes("Critical Game Error")) {
                            websocket.current?.close(); // Close connection
                            setGameVersion(null); // Reset selection
                        }
                        break;
                    default:
                        console.warn('Unknown message type:', data.type);
                }
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
                console.log("Raw WS Data:", event.data); // Log raw data for debugging
            }
        };
    }, [isGameOver]); // Add isGameOver dependency

    // Effect to connect/disconnect WebSocket based on gameVersion
    useEffect(() => {
        if (gameVersion) {
            connectWebSocket(gameVersion);
        }
        // Cleanup function: Close WebSocket when component unmounts or gameVersion changes *to null*
        return () => {
            if (websocket.current) {
                console.log("Closing WebSocket connection via cleanup effect.");
                websocket.current.onclose = null; // Prevent onclose handler from triggering state updates during cleanup
                websocket.current.close(1000, "Client changing version or unmounting");
                websocket.current = null;
                setIsConnected(false);
                // Don't reset gameVersion here, let the selection logic handle it
            }
        };
    }, [gameVersion, connectWebSocket]);

    // Button Handlers
    const handleVersionSelect = (version) => {
        if (!isConnected && !gameVersion) {
            setGameVersion(version); // Triggers useEffect
        } else if (isGameOver || !isConnected) {
            // Reset flow: Set version to null first to trigger cleanup, then set new version
            setGameVersion(null);
            setTimeout(() => {
                setGameVersion(version);
            }, 50); // Short delay
        }
    };

    const handlePlayAgain = () => {
        setIsGameOver(false);
        updateMessage("Select game version to start.");
        setGameVersion(null); // Resets UI and triggers cleanup effect
        setGameState(null);
        setVideoSrc('');
        setTransformedVideoSrc('');
        setShowError(null);
    };

    // Card Rendering Logic
    const renderCardContent = (cardIndex) => {
        const cardState = gameState?.card_states?.[cardIndex] ?? null;
        const isCurrentlyFlipped = gameState?.current_flipped?.includes(cardIndex);
        const isMatched = cardState?.isMatched;
        // Determine if the card should appear face-up
        const showFace = isCurrentlyFlipped || (cardState?.isFlippedBefore && !isMatched); // Show if active or previously flipped (and not matched)

        let cardFaceContent = null;
        let cardFaceBgStyle = {backgroundColor: colorMap.default_flipped}; // Default face bg

        if (showFace) {
            let colorKey = null;

            if (gameVersion === 'yolo' && cardState?.object) {
                // For YOLO, use images instead of text
                const objectName = cardState.object.toLowerCase();
                colorKey = objectName;

                // Handle special cases with spaces in filename
                const imageName = objectName.replace(' ', '_');

                cardFaceContent = (<div
                    className="absolute inset-0 w-full h-full flex items-center justify-center rounded-lg text-center p-1 backface-hidden"
                    style={{backgroundColor: 'white', transform: 'rotateY(180deg)'}}
                >
                    <img
                        src={`/images/${imageName}.png`}
                        alt={objectName}
                        className="max-h-[80%] max-w-[80%] object-contain"
                    />
                </div>);
            } else if (gameVersion === 'color' && cardState?.color) {
                // For color, just display the color without text
                colorKey = cardState.color.toLowerCase();

                if (colorKey && colorMap[colorKey]) {
                    cardFaceBgStyle = {backgroundColor: colorMap[colorKey]};
                }

                cardFaceContent = (<div
                    className="absolute inset-0 w-full h-full flex items-center justify-center rounded-lg backface-hidden"
                    style={{...cardFaceBgStyle, transform: 'rotateY(180deg)'}}
                >
                    {/* No text content for color cards */}
                </div>);
            } else if (cardState?.isFlippedBefore) {
                // Error state remains the same
                colorKey = 'detect_fail';

                cardFaceBgStyle = {backgroundColor: colorMap[colorKey]};

                cardFaceContent = (<div
                    className="absolute inset-0 w-full h-full flex items-center justify-center rounded-lg text-center p-1 backface-hidden"
                    style={{...cardFaceBgStyle, transform: 'rotateY(180deg)'}}
                >
                        <span className="text-xs sm:text-sm md:text-base font-semibold text-gray-800 break-words">
                            Error
                        </span>
                </div>);
            }
        }

        // Card container with transition logic
        return (<div key={cardIndex} className="perspective w-full aspect-square">
            <div
                className={`relative w-full h-full transition-transform duration-700 ease-in-out preserve-3d ${showFace ? 'rotate-y-180' : ''} ${isMatched ? 'opacity-20 scale-95 pointer-events-none' : ''} ${isCurrentlyFlipped ? 'ring-4 ring-yellow-400 ring-offset-2 scale-105 shadow-xl z-10' : 'shadow-md'}`}
            >
                {/* Card Back */}
                <div
                    className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center backface-hidden card-back-content">
                    {/* Content is handled by ::before pseudo-element in CSS */}
                </div>
                {/* Card Face (conditionally rendered or always present based on complexity) */}
                {cardFaceContent}
            </div>
        </div>);
    };


    // --- JSX Structure ---
    return (
      <div className="flex flex-col items-center gap-4 p-4 min-h-screen bg-gradient-to-br from-blue-100 via-white to-yellow-100">
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl p-8 mt-4 border border-gray-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-blue-900 drop-shadow">
                Memory Puzzle Game
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <span
                className={`px-2 py-1 rounded font-semibold text-xs shadow ${
                  isConnected
                    ? "bg-green-100 text-green-700 border border-green-300"
                    : "bg-red-100 text-red-700 border border-red-300"
                }`}
              >
                {isConnected ? "Connected" : "Disconnected"}
                {isConnected && gameVersion && ` (${gameVersion.charAt(0).toUpperCase() + gameVersion.slice(1)})`}
              </span>
              {(!gameVersion || isGameOver) ? null : (
                <button
                  onClick={handlePlayAgain}
                  className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 shadow transition"
                  disabled={!isConnected}
                >
                  Reset Game
                </button>
              )}
            </div>
          </div>

          {/* Error Display */}
          {showError && (
            <div className="w-full bg-red-700 border border-red-500 text-red-100 px-4 py-2 rounded-md shadow-lg mb-4 text-sm" role="alert">
              <strong className="font-bold">Error: </strong>
              <span className="block sm:inline">{showError}</span>
            </div>
          )}

          {/* Version Selector / Play Again Buttons */}
          {(!gameVersion || isGameOver) && (
            <div className="flex flex-col sm:flex-row items-center justify-center space-y-3 sm:space-y-0 sm:space-x-4 mb-6 p-4 ">
              {!isGameOver ? (
                <>
                  <button
                    onClick={() => handleVersionSelect('yolo')}
                    disabled={isConnected || !!gameVersion}
                    className="px-6 py-3 text-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md shadow-lg hover:from-purple-700 hover:to-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-opacity-75 w-full sm:w-auto"
                  >
                    Start YOLO
                  </button>
                  <button
                    onClick={() => handleVersionSelect('color')}
                    disabled={isConnected || !!gameVersion}
                    className="px-6 py-3 text-lg bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-md shadow-lg hover:from-teal-600 hover:to-cyan-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-75 w-full sm:w-auto"
                  >
                    Start Color
                  </button>
                </>
              ) : (
                <button
                  onClick={handlePlayAgain}
                  className="px-8 py-4 text-xl bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-md shadow-xl hover:from-green-600 hover:to-emerald-700 transition-all transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-opacity-75"
                >
                  Play Again?
                </button>
              )}
            </div>
          )}

          {/* Status Bar */}
          <div className="w-full bg-gray-50  p-4 mb-6 flex flex-wrap justify-between items-center gap-x-4 gap-y-2 text-xs sm:text-sm">
            <span>
              Status:
              <span className={`ml-1 font-semibold ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
              {isConnected && gameVersion && ` (${gameVersion.charAt(0).toUpperCase() + gameVersion.slice(1)})`}
            </span>
            <span className="text-center flex-grow mx-2 truncate font-medium text-gray-700" title={message}>{message}</span>
            <span>
              Pairs: <strong className="text-yellow-600">{gameState?.pairs_found ?? 0}</strong> / {CARD_COUNT / 2}
            </span>
          </div>

          {/* Game Area */}
          {gameVersion && !isGameOver && isConnected && (
            <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 w-full max-w-6xl">
              {/* Left Column: Feeds */}
              <div className="flex flex-col gap-4 sm:gap-6 lg:w-1/2">
                {/* Main Camera Feed */}
                <div className="bg-gray-800 p-3 sm:p-4 rounded-lg shadow-xl border border-gray-700">
                  <h2 className="text-xl sm:text-2xl font-semibold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-500">Live Camera</h2>
                  <div className="w-full aspect-video bg-gray-700 border border-gray-600 rounded overflow-hidden">
                    {videoSrc ? (
                      <img src={videoSrc} alt="Live feed" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        {isConnected ? "Waiting for camera..." : "Connecting..."}
                      </div>
                    )}
                  </div>
                </div>

                {/* Transformed Board Feed */}
                <div className="bg-gray-800 p-3 sm:p-4 rounded-lg shadow-xl border border-gray-700">
                  <h2 className="text-xl sm:text-2xl font-semibold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-lime-400 to-green-500">Detected Board</h2>
                  <div
                    className="w-full bg-gray-700 border border-gray-600 rounded overflow-hidden relative"
                    style={{ paddingTop: `${(BOARD_DETECT_HEIGHT / BOARD_DETECT_WIDTH) * 100}%` }}
                  >
                    {transformedVideoSrc ? (
                      <img src={transformedVideoSrc} alt="Transformed board" className="absolute inset-0 w-full h-full object-contain" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs p-2 text-center">
                        {videoSrc && isConnected ? 'Waiting for board detection...' : (isConnected ? 'Camera feed needed' : 'Connecting...')}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Game Board */}
              <div className="bg-gray-800 p-3 sm:p-4 rounded-lg shadow-xl border border-gray-700 lg:w-1/2">
                <h2 className="text-xl sm:text-2xl font-semibold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">Game Board</h2>
                <div className={`grid grid-cols-${GRID_COLS} gap-2 sm:gap-3 lg:gap-4`}>
                  {Array.from({ length: CARD_COUNT }).map((_, index) => renderCardContent(index))}
                </div>
              </div>
            </div>
          )}

          {/* Placeholder when not connected or version not selected */}
          {(!gameVersion || !isConnected) && !isGameOver && (
            <div className="mt-10 text-gray-500 text-center">
              Please select a game version to begin.
            </div>
          )}
        </div>
      </div>
    );
}

// Add utility classes for Tailwind JIT (if needed, or rely on safelist in config)
// These are for the 3D flip effect
const _perspective = 'perspective'; // Define these strings to potentially help JIT
const _preserve3d = 'preserve-3d';
const _rotateY180 = 'rotate-y-180';
const _backfaceHidden = 'backface-hidden';