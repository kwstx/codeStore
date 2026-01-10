document.addEventListener('DOMContentLoaded', () => {
    // HAMBURGER MENU LOGIC
    const hamburger = document.querySelector('.hamburger');
    const navLinks = document.querySelector('.nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navLinks.classList.toggle('active');
        });

        // Close menu when clicking a link
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navLinks.classList.remove('active');
            });
        });
    }

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
    if (slider) {
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
    }
    // Feature Card Interaction
    const cards = document.querySelectorAll('.feature-card');
    console.log('Found feature cards:', cards.length);

    cards.forEach(card => {
        card.addEventListener('click', function () {
            console.log('Card clicked!');
            // Remove active from all
            cards.forEach(c => c.classList.remove('active'));
            // Add active to THIS card
            this.classList.add('active');
        });
    });

    // Navigation Pill Logic
    const navPrev = document.getElementById('nav-prev');
    const navNext = document.getElementById('nav-next');
    const slide1 = document.getElementById('card-slide-1');
    const slide2 = document.getElementById('card-slide-2');

    console.log('Nav Elements:', { navPrev, navNext, slide1, slide2 });

    if (navPrev && navNext && slide1 && slide2) {
        let isAnimating = false;

        const toggleSlides = () => {
            if (isAnimating) return;
            isAnimating = true;

            console.log('Toggling slides with animation');

            const currentSlide = slide1.style.display !== 'none' ? slide1 : slide2;
            const nextSlide = currentSlide === slide1 ? slide2 : slide1;

            // 1. Animate Out
            currentSlide.classList.add('animate-out');

            currentSlide.addEventListener('animationend', () => {
                currentSlide.classList.remove('animate-out');
                currentSlide.style.display = 'none';

                // 2. Prepare Next Slide
                nextSlide.style.display = 'grid';
                nextSlide.classList.add('animate-in');

                nextSlide.addEventListener('animationend', () => {
                    nextSlide.classList.remove('animate-in');
                    isAnimating = false;
                }, { once: true });

            }, { once: true });
        };

        navPrev.addEventListener('click', toggleSlides);
        navNext.addEventListener('click', toggleSlides);
    } else {
        console.error('Navigation elements not found!');
    }
});
