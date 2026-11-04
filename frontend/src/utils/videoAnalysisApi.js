export async function analyzeWorkoutVideo(api, formData, { signal, onStatus = () => {} } = {}) {
  onStatus('uploading');
  let status, result;
  if (typeof XMLHttpRequest !== 'undefined') {
    ({ status, result } = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${api}/api/workouts/analyze-video`);
      xhr.responseType = 'json';
      xhr.timeout = 120000;
      const abort = () => xhr.abort();
      const cleanup = () => signal?.removeEventListener('abort', abort);
      xhr.upload.onload = () => { if (!signal?.aborted) onStatus('processing'); };
      xhr.onload = () => { cleanup(); resolve({ status: xhr.status, result: xhr.response }); };
      xhr.onerror = () => { cleanup(); reject(new Error('Cannot reach the video analysis service. Check your connection and try again.')); };
      xhr.ontimeout = () => { cleanup(); reject(new Error('The analysis request timed out. Your video is still selected; try a shorter clip.')); };
      xhr.onabort = () => { cleanup(); reject(new DOMException('Analysis request cancelled', 'AbortError')); };
      if (signal?.aborted) { reject(new DOMException('Analysis request cancelled', 'AbortError')); return; }
      signal?.addEventListener('abort', abort, { once: true });
      xhr.send(formData);
    }));
  } else {
    // Non-browser callers/tests can use fetch; no fabricated processing percentage.
    let response;
    try {
      response = await fetch(`${api}/api/workouts/analyze-video`, { method: 'POST', body: formData, signal });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('Cannot reach the video analysis service. Check your connection and try again.');
    }
    status = response.status;
    result = await response.json().catch(() => null);
  }
  if (status < 200 || status >= 300) {
    if (typeof result?.detail?.message === 'string') {
      const detail = result.detail;
      const diagnostics = detail.recognition_diagnostics;
      const message = detail.code === 'EXERCISE_UNCLEAR'
        ? (diagnostics?.rejection_reason === 'ambiguous_candidates'
          ? 'Multiple exercises matched this movement. Please select your exercise manually.'
          : 'Could not identify your exercise. Please select your exercise manually.')
        : detail.message;
      const error = new Error(message);
      error.code = detail.code;
      error.recognitionDiagnostics = diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics) ? diagnostics : null;
      throw error;
    }
    if (typeof result?.detail === 'string') throw new Error(result.detail);
    const hints = {
      400: 'Invalid upload. Choose a supported video and retry.',
      404: 'The video analysis endpoint is unavailable. The site administrator should check the deployed backend URL.',
      405: 'The upload reached a server that does not accept video analysis. The site administrator should check API routing.',
      408: 'Upload took too long. Try a smaller clip or a faster connection.',
      413: 'This video exceeds the hosting upload limit. Try a smaller video.',
      422: 'This video is invalid or exceeds the analysis limits. Try a short MP4 clip.',
      502: 'The video analysis service stopped or could not be reached. Try a shorter video or retry later.',
      503: 'Video analysis is busy or temporarily unavailable. Please retry shortly.',
      504: 'Video analysis exceeded the hosting time limit. Try a shorter video.',
    };
    throw new Error(hints[status] || `Video analysis failed (HTTP ${status}). Please retry or contact the site administrator.`);
  }
  if (!result || typeof result.reps_completed !== 'number') {
    throw new Error('The server returned an invalid analysis response. The site administrator should check API routing.');
  }
  onStatus('complete');
  return result;
}
