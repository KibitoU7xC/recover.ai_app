// Example: Add a background shadow to navbar on scroll
window.addEventListener('scroll', () => {
    const nav = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        nav.style.boxShadow = "0 4px 20px rgba(0,0,0,0.1)";
    } else {
        nav.style.boxShadow = "none";
    }
});

// Simple alert for buttons
document.querySelectorAll('.btn-primary').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if(btn.getAttribute('href') === "#") {
            e.preventDefault();
            alert("Booking system coming soon!");
        }
    });
});