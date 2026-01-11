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

    // Responsive Carousel Logic for "Keep Your Flow"
    const carouselContainer = document.getElementById('flow-carousel');
    const navPrev = document.getElementById('nav-prev');
    const navNext = document.getElementById('nav-next');

    if (carouselContainer && navPrev && navNext) {
        const cards = Array.from(carouselContainer.children).filter(child =>
            child.classList.contains('creator-card') || child.classList.contains('agent-card')
        );

        let currentIndex = 0;

        const getItemsPerPage = () => {
            return window.innerWidth <= 768 ? 1 : 2;
        };

        const updateVisibility = () => {
            const perPage = getItemsPerPage();

            // Safety check: ensure index allows for full page view if possible
            // But since we want simple paging:
            // Desktop: 0, 2
            // Mobile: 0, 1, 2, 3

            cards.forEach((card, index) => {
                if (index >= currentIndex && index < currentIndex + perPage) {
                    card.style.display = 'flex'; // Restore display
                    // Add animation class if needed, or just let it appear
                    card.classList.add('animate-in');
                } else {
                    card.style.display = 'none';
                    card.classList.remove('animate-in');
                }
            });
        };

        const nextSlide = () => {
            const perPage = getItemsPerPage();
            // Calculate max index
            // If 4 items, perPage 2: starts at 0, 2. Max valid start is 2.
            // If 4 items, perPage 1: starts at 0, 1, 2, 3. Max valid start is 3.

            if (currentIndex + perPage < cards.length) {
                currentIndex += perPage;
            } else {
                currentIndex = 0; // Loop back to start
            }
            updateVisibility();
        };

        const prevSlide = () => {
            const perPage = getItemsPerPage();

            if (currentIndex - perPage >= 0) {
                currentIndex -= perPage;
            } else {
                // Loop to end
                // If length 4, perPage 2: should go to 2.
                // If length 4, perPage 1: should go to 3.

                // Formula to find last page start:
                currentIndex = Math.floor((cards.length - 1) / perPage) * perPage;
            }
            updateVisibility();
        };

        navNext.addEventListener('click', nextSlide);
        navPrev.addEventListener('click', prevSlide);

        // Initial Render
        updateVisibility();

        // Handle Resize
        window.addEventListener('resize', () => {
            // Reset to start on resize to avoid index issues types
            currentIndex = 0;
            updateVisibility();
        });
    }
});
