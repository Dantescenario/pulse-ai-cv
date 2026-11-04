// The legacy MediaPipe bundle exposes window.Pose rather than ES module exports.
let loading;

export function loadPose() {
  if (window.Pose) return Promise.resolve(window.Pose);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${import.meta.env.BASE_URL}mediapipe/pose/pose.js`;
      script.onload = () => {
        if (typeof window.Pose === 'function') resolve(window.Pose);
        else {
          script.remove();
          reject(new Error('MediaPipe Pose constructor unavailable'));
        }
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Unable to load local MediaPipe Pose bundle'));
      };
      document.head.appendChild(script);
    }).catch(error => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}
