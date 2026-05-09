/**
 * =============================================================================
 * config.js — Configuration & global helpers
 * =============================================================================
 */

const CONFIG = {
  API_BASE_URL : window.location.hostname === 'localhost' ||
                 window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8090'
    : window.location.origin,
  VERSION : '5.1.0',
};

/**
 * Escape a string for safe HTML insertion.
 * Defined here so all other modules can use it — loaded first.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}
document.addEventListener("DOMContentLoaded", () => {
      const currentPath = window.location.pathname;
      const navLinks = document.querySelectorAll('.nav-link, .bottom-nav-item');

      navLinks.forEach(link => {
        const linkHref = link.getAttribute('href');
        
        // Clear previous active states first to see the change
        link.classList.remove('active');

        if ((currentPath === '/' || currentPath.endsWith('index.html')) && linkHref === 'index.html') {
          link.classList.add('active');
        } 
        else if (linkHref && currentPath.includes(linkHref) && linkHref !== 'index.html') {
          link.classList.add('active');
        }
      });
      
      console.log("Nav check complete. Current path detected as:", currentPath);
      console.log("Found links:", navLinks.length);
});
