document.addEventListener('DOMContentLoaded', () => {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const header = item.querySelector('.faq-header');

        header.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all other items (optional - if we want only one open at a time)
            // faqItems.forEach(otherItem => {
            //     otherItem.classList.remove('active');
            // });

            if (!isActive) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    });

    // Drag to Scroll Logic for Products Grid
    const slider = document.querySelector('.products-grid');
    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        slider.classList.add('active'); // Change cursor
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });

    slider.addEventListener('mouseleave', () => {
        isDown = false;
        slider.classList.remove('active');
    });

    slider.addEventListener('mouseup', () => {
        isDown = false;
        slider.classList.remove('active');
    });

    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault(); // Stop selection of text
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 2; // Scroll-fast multiplier
        slider.scrollLeft = scrollLeft - walk;
    });
});
