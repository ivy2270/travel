const { createApp, ref, computed, onMounted } = Vue;
const GAS_URL = "https://script.google.com/macros/s/AKfycbzsM5ji2zztA6-EeCBUzTpVdN9bcom4RrVej8_imJABKmyZ0VWOSLY8DNv2ZL1KcOVG/exec"; 

createApp({
    setup() {
        const currentTab = ref('itinerary');
        const loading = ref(false);
        const uploading = ref(false); 
        const uploadProgress = ref({ current: 0, total: 0 }); 
        const showModal = ref(false);
        const isEditing = ref(false);
        const filterDate = ref("");
        const selectedWishTags = ref([]); 
        const wishSearchQuery = ref(""); 
        const debtFilter = ref({ payer: 'all', debtor: 'all' });
        
        // --- 燈箱增強版狀態 ---
        const lightboxUrl = ref(null); 
        const lightboxUrls = ref([]); 
        const lightboxIndex = ref(0); 
        const zoomScale = ref(1);
        const offsetX = ref(0);
        const offsetY = ref(0);
        const isDragging = ref(false);
        const startPoint = ref({ x: 0, y: 0 });
        const lastDist = ref(0);

        const touchState = ref({ startX: 0, startY: 0, moveX: 0 });
        const expandedItems = ref([]); 
        const allData = ref({ itinerary: [], expenses: [], wishes: [], settings: {} });
        const form = ref({});
        const settingForm = ref({ travelers: "", categories: "", wishTags: "", paymentMethods: "現金, 信用卡" });
        const localRates = ref([]);
        
        const tabNames = { itinerary:'行程', expense:'記帳', wish:'許願', setting:'設定' };
        const tabIcons = { itinerary:'fa-calendar-days', expense:'fa-wallet', wish:'fa-wand-magic-sparkles', setting:'fa-gear' };

        // --- 工具函數 ---
        const getDirectImageUrl = (url) => {
            if (!url || typeof url !== 'string') return '';
            const match = url.match(/\/d\/([^\/]+)/) || url.match(/[?&]id=([^&]+)/);
            if (match && match[1]) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=s1000`;
            return url;
        };

        const parseImages = (imgData) => {
            if (!imgData) return [];
            let urls = [];
            try {
                if (typeof imgData === 'string' && imgData.startsWith('[')) urls = JSON.parse(imgData);
                else if (typeof imgData === 'string') urls = imgData.split(',').filter(x => x);
                else urls = Array.isArray(imgData) ? imgData : [imgData];
            } catch (e) { urls = [imgData]; }
            return urls.map(url => getDirectImageUrl(String(url)));
        };

        const rawToDateStr = (raw) => (raw && String(raw).includes('T')) ? raw.split('T')[0] : String(raw || "");

        // --- 燈箱手勢與縮放優化 ---
        const handleTouchStart = (e) => {
            if (e.touches.length === 2) {
                lastDist.value = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
            } else {
                isDragging.value = true;
                startPoint.value = { x: e.touches[0].pageX - offsetX.value, y: e.touches[0].pageY - offsetY.value };
                touchState.value.startX = e.touches[0].pageX;
                touchState.value.startY = e.touches[0].pageY;
            }
        };

        const handleTouchMove = (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                const delta = dist / lastDist.value;
                zoomScale.value = Math.min(Math.max(zoomScale.value * delta, 1), 4);
                lastDist.value = dist;
            } else if (isDragging.value) {
                if (zoomScale.value > 1) {
                    // 放大模式：單指拖動
                    offsetX.value = e.touches[0].pageX - startPoint.value.x;
                    offsetY.value = e.touches[0].pageY - startPoint.value.y;
                } else {
                    // 原尺寸模式：記錄滑動距離準備換頁
                    touchState.value.moveX = e.touches[0].pageX;
                }
            }
        };

        const handleTouchEnd = (e) => {
            if (zoomScale.value === 1) {
                const diffX = touchState.value.startX - touchState.value.moveX;
                if (Math.abs(diffX) > 50 && touchState.value.moveX !== 0) {
                    if (diffX > 0) nextPhoto();
                    else prevPhoto();
                }
            }
            isDragging.value = false;
            touchState.value.moveX = 0;
            if (zoomScale.value < 1.1) resetZoom();
        };

        const resetZoom = () => { zoomScale.value = 1; offsetX.value = 0; offsetY.value = 0; };
        const prevPhoto = () => {
            if (lightboxUrls.value.length <= 1) return;
            resetZoom();
            lightboxIndex.value = (lightboxIndex.value - 1 + lightboxUrls.value.length) % lightboxUrls.value.length;
            lightboxUrl.value = lightboxUrls.value[lightboxIndex.value];
        };
        const nextPhoto = () => {
            if (lightboxUrls.value.length <= 1) return;
            resetZoom();
            lightboxIndex.value = (lightboxIndex.value + 1) % lightboxUrls.value.length;
            lightboxUrl.value = lightboxUrls.value[lightboxIndex.value];
        };

        const zoomStyle = computed(() => ({
            transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${zoomScale.value})`,
            transition: isDragging.value ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }));

        // --- 分頁手勢邏輯優化 (解決行程頁難切換問題) ---
        onMounted(() => {
            let pStartX = 0, pStartY = 0;
            window.addEventListener('touchstart', (e) => {
                if (lightboxUrl.value || showModal.value) return;
                // 如果在卡片的圖片捲動區域滑動，降低干擾
                if (e.target.closest('.overflow-x-auto')) return;
                pStartX = e.touches[0].clientX;
                pStartY = e.touches[0].clientY;
            }, { passive: true });

            window.addEventListener('touchend', (e) => {
                if (lightboxUrl.value || showModal.value || e.target.closest('.overflow-x-auto')) return;
                const pEndX = e.changedTouches[0].clientX;
                const pEndY = e.changedTouches[0].clientY;
                const dx = pStartX - pEndX;
                const dy = pStartY - pEndY;

                // 判斷邏輯：水平位移 > 70 且 角度較平 (dx 是 dy 的 2 倍以上)
                if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) {
                    const tabs = Object.keys(tabNames);
                    let idx = tabs.indexOf(currentTab.value);
                    if (dx > 0 && idx < tabs.length - 1) currentTab.value = tabs[idx + 1];
                    else if (dx < 0 && idx > 0) currentTab.value = tabs[idx - 1];
                }
            }, { passive: true });
            
            fetchData();
        });

        // --- 剩餘原本的功能代碼 (保持不變) ---
        const fetchData = async () => {
            if (!allData.value.itinerary.length) loading.value = true; 
            try {
                const res = await fetch(GAS_URL).then(r => r.json());
                allData.value = res;
                settingForm.value = { ...res.settings };
                localRates.value = typeof res.settings.rates === 'string' ? JSON.parse(res.settings.rates) : (res.settings.rates || []);
            } catch (e) { console.error(e); } finally { loading.value = false; }
        };

        const submitForm = async () => {
            if (uploading.value) return alert("圖片上傳中...");
            loading.value = true;
            try {
                let dataToSave = { ...form.value };
                if (currentTab.value === 'expense') {
                    const rate = localRates.value.find(r => r.code === dataToSave.currency);
                    dataToSave.twd = Math.round(dataToSave.amount * (rate ? rate.rate : 1));
                }
                dataToSave.image = Array.isArray(form.value.image) ? JSON.stringify(form.value.image) : (form.value.image || "");
                const sheet = { itinerary: 'Itinerary', expense: 'Expenses', wish: 'Wishes' }[currentTab.value];
                await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: isEditing.value ? 'updateData' : 'addData', data: dataToSave, id: form.value.id || null, sheet }) });
                showModal.value = false;
                fetchData();
            } catch (e) { alert("儲存失敗"); } finally { loading.value = false; }
        };

        // --- 返回所有屬性 ---
        return {
            currentTab, loading, uploading, uploadProgress, allData, tabNames, tabIcons, showModal, isEditing, form, settingForm, localRates,
            lightboxUrl, lightboxUrls, zoomStyle, handleTouchStart, handleTouchMove, handleTouchEnd,
            prevPhoto, nextPhoto,
            filteredItinerary: computed(() => {
                let list = [];
                allData.value.itinerary.forEach(item => {
                    list.push({ ...item, isExtraDay: false });
                    if (item.category === '飯店' && item.duration > 1) {
                        for (let i = 1; i < item.duration; i++) {
                            let d = new Date(rawToDateStr(item.day)); d.setDate(d.getDate() + i);
                            list.push({ ...item, day: d.toISOString().split('T')[0], isExtraDay: true });
                        }
                    }
                });
                return list.filter(i => filterDate.value ? rawToDateStr(i.day) === filterDate.value : true).sort((a,b) => rawToDateStr(a.day).localeCompare(rawToDateStr(b.day)) || String(a.time).localeCompare(String(b.time)));
            }),
            sortedExpensesByFilter: computed(() => {
                return [...allData.value.expenses].filter(exp => {
                    const matchPayer = debtFilter.value.payer === 'all' || exp.payer === debtFilter.value.payer;
                    const debtors = exp.debtor ? exp.debtor.split(',') : [];
                    return matchPayer && (debtFilter.value.debtor === 'all' || debtors.includes(debtFilter.value.debtor));
                }).sort((a,b) => rawToDateStr(b.date).localeCompare(rawToDateStr(a.date)));
            }),
            filteredTotalTWD: computed(() => {
                const total = [...allData.value.expenses].reduce((sum, exp) => sum + Number(exp.twd || 0), 0);
                return `NT$ ${total.toLocaleString()}`;
            }),
            filteredWishes: computed(() => {
                return [...allData.value.wishes].filter(wish => {
                    const matchTags = selectedWishTags.value.length === 0 || selectedWishTags.value.every(tag => (wish.tag || "").split(',').includes(tag));
                    return matchTags && (!wishSearchQuery.value || wish.content.toLowerCase().includes(wishSearchQuery.value.toLowerCase()));
                }).sort((a, b) => (isWishDone(a) === isWishDone(b)) ? 0 : (isWishDone(a) ? 1 : -1));
            }),
            availableDates: computed(() => [...new Set(allData.value.itinerary.map(i => rawToDateStr(i.day)))].filter(d => d && !d.includes('1899')).sort()),
            openAddModal: () => {
                isEditing.value = false;
                const today = new Date().toISOString().split('T')[0];
                const ts = (settingForm.value.travelers || "").split(',').filter(x=>x);
                if(currentTab.value === 'itinerary') form.value = { day:today, time:'', category:'景點', content:'', location:'', remark:'', duration:1, image: [] };
                else if(currentTab.value === 'expense') form.value = { date: today, item: '', amount: 0, currency: localRates.value[0]?.code || 'TWD', payer: ts[0] || "", debtor: ts[0] || "", paymentMethod: "現金", remark: '', image: "" };
                else form.value = { tag: '', content: '', payer: ts[0] || "", isDone: false, image: [] };
                showModal.value = true;
            },
            openEditModal: (item) => {
                isEditing.value = true;
                form.value = JSON.parse(JSON.stringify(item));
                const parsed = parseImages(item.image);
                form.value.image = (currentTab.value === 'expense') ? (parsed[0] || "") : parsed;
                showModal.value = true;
            },
            deleteItem: async (sheet, id) => { if(confirm("確定刪除？")) { loading.value = true; await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteData', id, sheet }) }); fetchData(); } },
            toggleWishDone: async (wish) => { loading.value = true; await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'updateData', data: { ...wish, isDone: !wish.isDone }, id: wish.id, sheet: 'Wishes' }) }); fetchData(); },
            openLightbox: (images, index) => {
                const urls = Array.isArray(images) ? images : parseImages(images);
                if (!urls.length) return;
                lightboxUrls.value = urls;
                lightboxIndex.value = index;
                lightboxUrl.value = urls[index];
                resetZoom();
            },
            formatDisplayDate: (d) => rawToDateStr(d).split('-').slice(1).join('/'),
            formatDisplayTime: (t) => t ? String(t).padStart(4, '0').replace(/(..)(..)/, '$1:$2') : '--:--',
            getWeekday: (d) => d ? ['週日','週一','週二','週三','週四','週五','週六'][new Date(d).getDay()] : "",
            parseImages,
            handlePayerSelect: (t) => { form.value.payer = t; if (currentTab.value === 'expense') form.value.debtor = t; },
            toggleSelection: (it, f) => { let c = (form.value[f] || "").split(',').filter(x => x); const i = c.indexOf(it); if (i > -1) c.splice(i, 1); else c.push(it); form.value[f] = c.join(','); },
            isItemSelected: (it, f) => (form.value[f] || "").split(',').includes(it),
            travelersAndCats: computed(() => ({ 
                travelers: (settingForm.value.travelers || "").split(',').filter(x=>x),
                cats: (settingForm.value.categories || "").split(',').filter(x=>x),
                tags: (settingForm.value.wishTags || "").split(',').filter(x=>x),
                paymentMethods: (settingForm.value.paymentMethods || "現金,信用卡").split(',').filter(x=>x)
            })),
            compressAndUpload,
            removeImage: (idx) => { if(currentTab.value==='expense') form.value.image=''; else form.value.image.splice(idx,1); },
            isWishDone,
            parseTodos: (text) => text ? text.split('\n').filter(line => line.trim().startsWith('- [')).map(line => ({ done: line.includes('[x]'), text: line.replace(/- \[[x ]\]/, '').trim() })) : [],
            toggleSubTodo,
            insertTodoTag,
            handleWishKeydown
        };
    }
}).mount('#app');
