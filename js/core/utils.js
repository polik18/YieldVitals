
        function showToast(message) {
            const toast = document.getElementById('toast');
            document.getElementById('toastMsg').textContent = message;
            toast.classList.remove('translate-y-20', 'opacity-0');
            setTimeout(() => {
                toast.classList.add('translate-y-20', 'opacity-0');
            }, 3000);
        }

        function setStatus(id, text, state = 'idle') {
            const el = document.getElementById(`item-${id}`);
            const val = el.querySelector('.value');
            const ind = el.querySelector('.indicator');

            el.classList.remove('opacity-50');
            val.className = 'text-right w-24 value';
            ind.className = 'w-2 h-2 rounded-full indicator transition-all';
            val.textContent = text;

            if (state === 'running') {
                val.classList.add('text-primary', 'animate-pulse');
                ind.classList.add('bg-yellow-400', 'animate-ping');
            } else if (state === 'done') {
                val.classList.add('text-white');
                ind.classList.add('bg-primary');
            } else if (state === 'error') {
                val.classList.add('text-red-400');
                ind.classList.add('bg-red-500');
            } else {
                el.classList.add('opacity-50');
                ind.classList.add('bg-slate-600');
            }
        }

        function setButtonLoading(isLoading) {
            const btn = document.getElementById('startBtn');
            const icon = btn.querySelector('.btn-icon');
            const text = btn.querySelector('.btn-text');
            const cancelBtn = document.getElementById('cancelBtn');
            const modeInputs = document.querySelectorAll('input[name="testMode"]');

            if (isLoading) {
                btn.disabled = true;
                icon.innerHTML = `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none" class="opacity-25"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>`;
                icon.classList.add('animate-spin');
                text.textContent = t('status_running');
                btn.classList.replace('bg-primary', 'bg-slate-700');
                cancelBtn.classList.remove('hidden');
                modeInputs.forEach(input => input.disabled = true);
            } else {
                btn.disabled = false;
                icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>`;
                icon.classList.remove('animate-spin');
                text.textContent = t('btn_retest');
                btn.classList.replace('bg-slate-700', 'bg-primary');
                cancelBtn.classList.add('hidden');
                modeInputs.forEach(input => input.disabled = false);
            }
        }

        function resetUI() {
            // 清空列表狀態
            ['cpu', 'string', 'ram', 'dom', 'canvas2d', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {
                setStatus(id, t('status_waiting'), 'idle');
                document.getElementById(`res-${id}`).innerHTML = `-- <span class="text-xs font-normal text-slate-500"></span>`;
            });
            document.getElementById('res-crypto').classList.remove('text-yellow-400');
            document.getElementById('cryptoWarning').classList.add('hidden');

            // 隱藏錯誤與報告按鈕
            hideError();
            document.getElementById('reliabilityBox').classList.add('hidden');
            document.getElementById('copyReportBtn').classList.add('hidden');

            // 關閉 GPU 殘留
            const container = document.getElementById('threeContainer');
            if (container) {
                container.classList.add('hidden');
                container.classList.remove('flex');
                const canvas = container.querySelector('canvas');
                if (canvas) container.removeChild(canvas);
            }

            // 清空 DOM 沙盒
            document.getElementById('domSandbox').innerHTML = '';

            // 重設天梯與文字
            document.getElementById('tierBar').style.width = '0%';
            document.getElementById('scoreMarker').style.opacity = '0';
            const tierText = document.getElementById('tierText');
            tierText.classList.add('hidden');
            tierText.innerHTML = '';

            // 重設雷達圖
            if (radarChart) {
                radarChart.data.datasets[0].data = [0, 0, 0, 0, 0, 0, 0, 0];
                radarChart.update();
            }
        }

        function showError(message) {
            const errDiv = document.getElementById('globalError');
            errDiv.textContent = `⚠️ ${t('error_msg')}: ${message}`;
            errDiv.classList.remove('-translate-y-full');
            // 掃描並標記失敗項目
            ['cpu', 'string', 'ram', 'dom', 'canvas2d', 'gpu', 'crypto', 'storage', 'network'].forEach(id => {
                const el = document.getElementById(`item-${id}`);
                if (el.querySelector('.indicator').classList.contains('bg-yellow-400')) {
                    setStatus(id, t('status_error') || 'Error', 'error');
                }
            });
        }

        function hideError() {
            document.getElementById('globalError').classList.add('-translate-y-full');
        }

        function showFatalError(msg) {
            resetUI();
            showError(msg);
            document.getElementById('startBtn').disabled = true;
            document.getElementById('startBtn').classList.replace('bg-primary', 'bg-slate-700');
            document.querySelector('.btn-text').textContent = t('error_env');
        }

        function checkDependencies() {
            if (!window.Chart) return t('error_chart_load');
            if (!window.THREE) return t('error_three_load');
            return null;
        }

        function withTimeout(promise, ms, label) {
            return Promise.race([
                promise,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`${label} ${t('error_timeout')} (${ms}ms)`)), ms);
                })
            ]);
        }

        // Hyperbolic saturation normalization: score = 100 * ratio / (ratio + 0.5)
        // This is a Michaelis-Menten curve — smooth, never extreme, no log instability.
        // At baseline (ratio=1.0) → 67,  at 2x → 80,  at 0.5x → 50,  at 0.25x → 33
        // Much gentler than sigmoid — avoids the "all-zeros or all-100s" radar problem.
        function normalize(value, baseline) {
            if (!value || value <= 0) return 0;
            const ratio = value / baseline;
            const score = 100 * ratio / (ratio + 0.5);
            return Math.round(Math.min(Math.max(score, 0), 100));
        }

        function supportsWebGL() {
            try {
                const canvas = document.createElement('canvas');
                return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
            } catch (e) { return false; }
        }

        // cancelBtn listeners moved to DOMContentLoaded

        // 1. CPU 多核心測試 (Worker)
