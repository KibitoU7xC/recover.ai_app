
        const ctx = document.getElementById('trendsChart').getContext('2d');
        
        // Custom plugin to draw legend labels like in Figma
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                datasets: [
                    {
                        label: 'Steps',
                        data: [6500, 7200, 9000, 9500, 5800, 10500, 4500],
                        backgroundColor: '#00c897',
                        borderRadius: 5,
                        barThickness: 20,
                        order: 2
                    },
                    {
                        label: 'Calories (kcal)',
                        data: [1800, 1950, 2100, 2300, 1700, 2600, 1400],
                        type: 'line',
                        borderColor: '#ff8a00',
                        borderWidth: 3,
                        pointBackgroundColor: '#ff8a00',
                        tension: 0.4,
                        order: 1,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, padding: 20 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { borderDash: [5, 5], drawBorder: false },
                        max: 12000
                    },
                    y1: {
                        position: 'right',
                        beginAtZero: true,
                        grid: { display: false },
                        max: 3000
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
 