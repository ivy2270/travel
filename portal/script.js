const { createApp, ref, computed, onMounted, watch } = Vue;

const CATALOG_SERVICE_URL = "https://script.google.com/macros/s/AKfycbxA8phevTocRDd0WlcguLa4JIwgYbJnILJF97ZTCAgDeUhC2FUtJ2KWzpRaZnDA0efSMA/exec";

async function initPlatform() {
    const urlParams = new URLSearchParams(window.location.search);
    const tripId = urlParams.get('trip');

    if (!tripId) {
        showErrorPage("請提供行程 ID");
        return;
    }

    updatePwaManifest("載入中...", tripId, "", 'spring');

    try {
        const res = await fetch(`${CATALOG_SERVICE_URL}?trip=${tripId}`).then(r => r.json());
        
        if (res.error) {
            showErrorPage(`找不到行程: ${tripId}`);
            return;
        }

        const keyFromUrl = urlParams.get('key');
        if (keyFromUrl !== null) {
            if (keyFromUrl.trim() !== "") {
                localStorage.setItem(`key_${tripId}`, keyFromUrl);
            } else {
                localStorage.removeItem(`key_${tripId}`);
            }
        } else {
            localStorage.removeItem(`key_${tripId}`);
        }

        const currentKey = localStorage.getItem(`key_${tripId}`) || "";
        updatePwaManifest(res.display_name || "拾光旅圖", tripId, currentKey, res.theme_id || 'spring');
        startApp(res, tripId);

    } catch (err) {
        showErrorPage("總機連線失敗");
    }
}

function startApp(BOOT_CONFIG, tripId) {
    const theme = BOOT_CONFIG.theme_id || 'spring';
    document.documentElement.setAttribute('data-theme', theme);
    document.title = BOOT_CONFIG.display_name;

    createApp({
        setup() {
            const GAS_URL = BOOT_CONFIG.gas_url;
            
            const USER_KEY = ref(localStorage.getItem(`key_${tripId}`) || "");
            const isAdmin = computed(() => {
                const k = USER_KEY.value;
                return k && String(k).trim() !== "" && String(k) !== "null";
            });

            // --- Toast 狀態與功能 ---
            const toast = ref({ show: false, msg: '', type: 'success' });
            const showToast = (msg, type = 'success') => {
                toast.value = { show: true, msg, type };
                setTimeout(() => { toast.value.show = false; }, 3000);
            };

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
            
            const lightboxUrl = ref(null); 
            const lightboxUrls = ref([]); 
            const lightboxIndex = ref(0); 
            const zoomScale = ref(1);
            const lastScale = ref(1);
            const offsetX = ref(0);
            const offsetY = ref(0);
            const touchStartDist = ref(0);
            const touchStartPoint = ref({ x: 0, y: 0 });
            const isDragging = ref(false);
            const touchState = ref({ startX: 0, startY: 0, endX: 0, endY: 0 });
            const imgTouchState = ref({ startX: 0, startY: 0 });

            const expandedItems = ref([]); 
            const allData = ref({ itinerary: [], expenses: [], wishes: [], settings: {} });
            const form = ref({});
            const settingForm = ref({ travelers: "", categories: "", wishTags: "", paymentMethods: "現金,信用卡" });
            const localRates = ref([]);
            
            let syncTimer = null;
            const pendingWishes = new Set();

            const tabNames = { itinerary:'行程', expense:'記帳', wish:'許願', setting:'設定' };
            const tabIcons = { itinerary:'fa-calendar-days', expense:'fa-wallet', wish:'fa-wand-magic-sparkles', setting:'fa-gear' };
            
            const handleApiError = (res) => {
                if (res && res.message && (res.message.includes("金鑰") || res.message.includes("權限"))) {
                    showToast("驗證失敗，管理功能已停用", "error");
                    USER_KEY.value = "";
                    localStorage.removeItem(`key_${tripId}`);
                    updatePwaManifest(BOOT_CONFIG.display_name, tripId, "", BOOT_CONFIG.theme_id);
                } else {
                    showToast("操作失敗：" + (res.message || "未知錯誤"), "error");
                }
            };

            const categoryColorMap = computed(() => {
                const map = {};
                const categories = [...new Set((allData.value.itinerary || []).map(i => i.category).filter(Boolean))];
                categories.forEach((cat, index) => { map[cat] = `cat-color-${index % 6}`; });
                return map;
            });

            const getCategoryColorClass = (category) => {
                if (!category) return 'cat-color-0';
                return categoryColorMap.value[category] || 'cat-color-0';
            };

            const isWishDone = (wish) => {
                if (!wish) return false;
                if (typeof wish.isDone === 'boolean') return wish.isDone;
                return String(wish.isDone).toLowerCase() === 'true';
            };

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
                    if (typeof imgData === 'string' && (imgData.startsWith('[') || imgData.startsWith('{'))) urls = JSON.parse(imgData);
                    else if (typeof imgData === 'string') urls = imgData.split(',').filter(x => x);
                    else urls = Array.isArray(imgData) ? imgData : [imgData];
                } catch (e) { urls = [imgData]; }
                return (Array.isArray(urls) ? urls : [urls]).map(url => getDirectImageUrl(String(url)));
            };

            const rawToDateStr = (raw) => (raw && String(raw).includes('T')) ? raw.split('T')[0] : String(raw || "");

            const zoomStyle = computed(() => ({
                transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${zoomScale.value})`,
                transition: isDragging.value ? 'none' : 'transform 0.15s ease-out'
            }));

            const filteredItinerary = computed(() => {
                let list = [];
                (allData.value.itinerary || []).forEach(item => {
                    list.push({ ...item, isExtraDay: false });
                    if (item.category === '飯店' && item.duration > 1) {
                        for (let i = 1; i < item.duration; i++) {
                            let d = new Date(rawToDateStr(item.day));
                            d.setDate(d.getDate() + i);
                            list.push({ ...item, day: d.toISOString().split('T')[0], isExtraDay: true });
                        }
                    }
                });
                return list.filter(i => filterDate.value ? rawToDateStr(i.day) === filterDate.value : true)
                            .sort((a,b) => {
                               const dateA = rawToDateStr(a.day), dateB = rawToDateStr(b.day);
                               if (dateA !== dateB) return dateA.localeCompare(dateB);
                               const tA = String(a.time || "0000").padStart(4, '0'), tB = String(b.time || "0000").padStart(4, '0');
                               return tA.localeCompare(tB);
                            });
            });

            const sortedExpensesByFilter = computed(() => {
                return [...(allData.value.expenses || [])].filter(exp => {
                    const matchPayer = debtFilter.value.payer === 'all' || exp.payer === debtFilter.value.payer;
                    const debtors = exp.debtor ? exp.debtor.split(',') : [];
                    const matchDebtor = debtFilter.value.debtor === 'all' || debtors.includes(debtFilter.value.debtor);
                    return matchPayer && matchDebtor;
                }).sort((a,b) => rawToDateStr(b.date).localeCompare(rawToDateStr(a.date)) || (Number(b.id) - Number(a.id)));
            });
            
            const filteredTotalTWD = computed(() => {
                const total = sortedExpensesByFilter.value.reduce((sum, exp) => sum + Number(exp.twd || 0), 0);
                return `NT$ ${total.toLocaleString()}`;
            });

            const filteredWishes = computed(() => {
                let results = [...(allData.value.wishes || [])].filter(wish => {
                    const matchTags = selectedWishTags.value.length === 0 || 
                        selectedWishTags.value.every(tag => (wish.tag || "").split(',').includes(tag));
                    const query = (wishSearchQuery.value || "").toLowerCase().trim();
                    const matchSearch = !query || (wish.content || "").toLowerCase().includes(query) || (wish.tag && wish.tag.toLowerCase().includes(query));
                    return matchTags && matchSearch;
                });
                return results.sort((a, b) => {
                    const statusA = isWishDone(a) ? 1 : 0;
                    const statusB = isWishDone(b) ? 1 : 0;
                    if (statusA !== statusB) return statusA - statusB;
                    
                    const parseDate = (obj) => {
                        const timeStr = obj.updatetime || obj.updateTime || "";
                        if (!timeStr) return 0;
                        const d = new Date(String(timeStr).replace(/-/g, '/'));
                        return isNaN(d.getTime()) ? 0 : d.getTime();
                    };
                    const timeA = parseDate(a);
                    const timeB = parseDate(b);
                    if (timeB !== timeA) return timeB - timeA;
                    return (BigInt(String(b.id || 0).replace(/\D/g, '')) > BigInt(String(a.id || 0).replace(/\D/g, ''))) ? 1 : -1;
                });
            });

            const handleSwipe = () => {
                if (zoomScale.value > 1.1) return; 
                const swipeThreshold = 100;
                const verticalLimit = 40;
                const diffX = touchState.value.startX - touchState.value.endX;
                const diffY = touchState.value.startY - touchState.value.endY;

                if (Math.abs(diffX) > swipeThreshold && Math.abs(diffY) < verticalLimit && Math.abs(diffX) > Math.abs(diffY) * 3) {
                    const tabs = Object.keys(tabNames);
                    let currentIndex = tabs.indexOf(currentTab.value);
                    if (diffX > 0 && currentIndex < tabs.length - 1) currentTab.value = tabs[currentIndex + 1];
                    else if (diffX < 0 && currentIndex > 0) currentTab.value = tabs[currentIndex - 1];
                }
            };

            const handleTouchStartImg = (e) => {
                if (e.touches.length === 2) {
                    touchStartDist.value = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                } else if (e.touches.length === 1) {
                    imgTouchState.value.startX = e.touches[0].pageX;
                    imgTouchState.value.startY = e.touches[0].pageY;
                    if (zoomScale.value > 1) {
                        isDragging.value = true;
                        touchStartPoint.value = { x: e.touches[0].pageX - offsetX.value, y: e.touches[0].pageY - offsetY.value };
                    }
                }
            };

            const handleTouchMoveImg = (e) => {
                if (e.touches.length === 2) {
                    const currentDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                    const scale = (currentDist / touchStartDist.value) * lastScale.value;
                    zoomScale.value = Math.min(Math.max(scale, 1), 4);
                } else if (e.touches.length === 1 && isDragging.value) {
                    offsetX.value = e.touches[0].pageX - touchStartPoint.value.x;
                    offsetY.value = e.touches[0].pageY - touchStartPoint.value.y;
                }
            };

            const handleTouchEndImg = (e) => {
                isDragging.value = false;
                lastScale.value = zoomScale.value;
                if (zoomScale.value <= 1.1) {
                    const endX = e.changedTouches[0].pageX;
                    const diffX = imgTouchState.value.startX - endX;
                    const swipeThreshold = 50;
                    if (Math.abs(diffX) > swipeThreshold) {
                        if (diffX > 0) nextPhoto(); else prevPhoto();
                    }
                    zoomScale.value = 1; lastScale.value = 1; offsetX.value = 0; offsetY.value = 0;
                }
            };

            const resizeImage = (file) => {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = (e) => {
                        const img = new Image();
                        img.src = e.target.result;
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            let w = img.width, h = img.height, max = 1000;
                            if (w > h && w > max) { h *= max/w; w = max; } else if (h > max) { w *= max/h; h = max; }
                            canvas.width = w; canvas.height = h;
                            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                            resolve(canvas.toDataURL('image/webp', 0.8));
                        };
                    };
                });
            };

            const compressAndUpload = async (event) => {
                const files = event.target.files;
                if (!files.length) return;
                uploading.value = true;
                uploadProgress.value = { current: 0, total: files.length };
                for (let file of files) {
                    try {
                        const base64 = await resizeImage(file);
                        const res = await fetch(GAS_URL, {
                            method: 'POST',
                            body: JSON.stringify({ action: 'uploadImage', base64, fileName: `${Date.now()}.webp`, fileType: 'image/webp', key: USER_KEY.value })
                        }).then(r => r.json());
                        
                        if (res.success) {
                            if (currentTab.value === 'expense') form.value.image = res.url;
                            else {
                                if (!Array.isArray(form.value.image)) form.value.image = [];
                                form.value.image.push(res.url);
                            }
                        } else {
                            handleApiError(res);
                        }
                    } catch (e) { console.error(e); }
                    uploadProgress.value.current++;
                }
                uploading.value = false;
            };

            const fetchData = async () => {
                if (pendingWishes.size > 0) return;
                if (!allData.value.itinerary.length) loading.value = true; 
                try {
                    const url = isAdmin.value ? `${GAS_URL}?key=${USER_KEY.value}` : GAS_URL;
                    const res = await fetch(url).then(r => r.json());
                    allData.value = res;
                    if (res.appName) {
                        document.title = res.appName;
                        updatePwaManifest(res.appName, tripId, USER_KEY.value, BOOT_CONFIG.theme_id);
                    }
                    settingForm.value = { ...res.settings };
                    localRates.value = typeof res.settings.rates === 'string' ? 
                        JSON.parse(res.settings.rates) : (res.settings.rates || []);
                    localStorage.setItem(`cache_${tripId}`, JSON.stringify(res)); 
                } catch (e) { console.error("Fetch error:", e); } 
                finally { loading.value = false; }
            };

            const submitForm = async () => {
                if (uploading.value) return showToast("圖片上傳中...", "error");
                loading.value = true;
                try {
                    let dataToSave = { ...form.value };
                    const action = isEditing.value ? 'updateData' : 'addData';
                    const sheet = { itinerary: 'Itinerary', expense: 'Expenses', wish: 'Wishes' }[currentTab.value];
                    const res = await fetch(GAS_URL, { 
                        method: 'POST', 
                        body: JSON.stringify({ action, data: dataToSave, id: form.value.id || null, sheet, key: USER_KEY.value }) 
                    }).then(r => r.json());

                    if (res.success) {
                        showToast(isEditing.value ? "更新成功" : "儲存成功");
                        showModal.value = false;
                        fetchData();
                    } else { handleApiError(res); }
                } catch (e) { showToast("網路連線錯誤", "error"); } 
                finally { loading.value = false; }
            };

            const prevPhoto = () => {
                if (zoomScale.value > 1.1 || lightboxUrls.value.length === 0) return;
                lightboxIndex.value = (lightboxIndex.value - 1 + lightboxUrls.value.length) % lightboxUrls.value.length;
                lightboxUrl.value = lightboxUrls.value[lightboxIndex.value];
            };
            const nextPhoto = () => {
                if (zoomScale.value > 1.1 || lightboxUrls.value.length === 0) return;
                lightboxIndex.value = (lightboxIndex.value + 1) % lightboxUrls.value.length;
                lightboxUrl.value = lightboxUrls.value[lightboxIndex.value];
            };

            onMounted(() => {
                const cached = localStorage.getItem(`cache_${tripId}`);
                if (cached) { 
                    try { allData.value = JSON.parse(cached); } catch(e) {}
                }
                fetchData();

                window.addEventListener('keydown', (e) => {
                    if (lightboxUrl.value) {
                        if (e.key === 'ArrowLeft') prevPhoto();
                        if (e.key === 'ArrowRight') nextPhoto();
                        if (e.key === 'Escape') lightboxUrl.value = null;
                    }
                });

                window.addEventListener('touchstart', (e) => {
                    const target = e.target;
                    const isSwipeable = !target.closest('.table-container') && !target.closest('.itinerary-date-filter') && 
                                      !target.closest('.wish-tags-container') && !target.closest('.card-image-slider') && 
                                      !target.closest('textarea') && !target.closest('input') && !showModal.value && !lightboxUrl.value;
                    if (isSwipeable) {
                        touchState.value.startX = e.touches[0].clientX;
                        touchState.value.startY = e.touches[0].clientY;
                    } else { touchState.value.startX = 0; }
                }, { passive: true });

                window.addEventListener('touchend', (e) => {
                    if (touchState.value.startX === 0) return;
                    touchState.value.endX = e.changedTouches[0].clientX;
                    touchState.value.endY = e.changedTouches[0].clientY;
                    handleSwipe();
                }, { passive: true });
            });

            const parseContentDetailed = (text) => {
                if (!text) return [];
                return text.split('\n').map((line, index) => {
                    const isTodo = line.trim().startsWith('- [ ]') || line.trim().startsWith('- [x]');
                    return {
                        id: index,
                        isTodo: isTodo,
                        done: line.trim().startsWith('- [x]'),
                        text: isTodo ? line.replace(/- \[[x ]\]/, '').trim() : line
                    };
                });
            };

            const getCollapsedText = (text) => {
                if (!text) return "";
                return text.replace(/- \[[x ]\]/g, '').replace(/\n/g, ' ');
            };

            const toggleSubTodo = (wish, lineIndex) => {
                if (!isAdmin.value) return showToast("權限不足，無法勾選", "error");
                
                const lines = wish.content.split('\n');
                const targetLine = lines[lineIndex];
                
                if (targetLine.trim().startsWith('- [x]')) {
                    lines[lineIndex] = targetLine.replace('- [x]', '- [ ]');
                } else if (targetLine.trim().startsWith('- [ ]')) {
                    lines[lineIndex] = targetLine.replace('- [ ]', '- [x]');
                }

                wish.content = lines.join('\n');
                triggerSync(wish);
            };

            const toggleWishDone = (wish) => {
                if (!isAdmin.value) return showToast("權限不足", "error");
                wish.isDone = !isWishDone(wish);
                triggerSync(wish);
            };

            const triggerSync = (wish) => {
                pendingWishes.add(wish.id);
                if (syncTimer) clearTimeout(syncTimer);
                syncTimer = setTimeout(async () => {
                    const idsToSync = Array.from(pendingWishes);
                    pendingWishes.clear();

                    for (const id of idsToSync) {
                        const target = allData.value.wishes.find(w => w.id === id);
                        if (!target) continue;
                        try {
                            await fetch(GAS_URL, {
                                method: 'POST',
                                body: JSON.stringify({ 
                                    action: 'updateData', 
                                    data: { ...target }, 
                                    id: target.id, 
                                    sheet: 'Wishes', 
                                    key: USER_KEY.value 
                                })
                            });
                        } catch (e) { console.error("Sync failed for wish:", id); }
                    }
                }, 1500);
            };

            return { 
                isAdmin,
                toast,
                showToast,
                categoryColorMap, getCategoryColorClass,
                currentTab, loading, uploading, uploadProgress, allData, tabNames, tabIcons, filteredItinerary, sortedExpensesByFilter, filteredTotalTWD, filteredWishes,
                availableDates: computed(() => [...new Set((allData.value.itinerary || []).map(i => rawToDateStr(i.day)))].filter(d => d && !d.includes('1899')).sort()),
                filterDate, debtFilter, showModal, isEditing, form, 
                travelersAndCats: computed(() => ({ 
                    travelers: (settingForm.value.travelers || "").split(',').filter(x=>x),
                    cats: (settingForm.value.categories || "").split(',').filter(x=>x),
                    tags: (settingForm.value.wishTags || "").split(',').filter(x=>x),
                    paymentMethods: (settingForm.value.paymentMethods || "現金,信用卡").split(',').filter(x=>x)
                })), 
                localRates, settingForm, selectedWishTags, wishSearchQuery, lightboxUrl, lightboxUrls, zoomScale, zoomStyle,
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
                    if(form.value.day) form.value.day = rawToDateStr(form.value.day);
                    if(form.value.date) form.value.date = rawToDateStr(form.value.date);
                    showModal.value = true;
                },
                handlePayerSelect: (t) => {
                    form.value.payer = t;
                    if (currentTab.value === 'expense') form.value.debtor = t;
                },
                submitForm, fetchData, formatDisplayDate: (d) => rawToDateStr(d).split('-').slice(1).join('/'),
                formatDisplayTime: (t) => t ? String(t).padStart(4, '0').replace(/(..)(..)/, '$1:$2') : '--:--',
                getWeekday: (d) => d ? ['週日','週一','週二','週三','週四','週五','週六'][new Date(d).getDay()] : "",
                deleteItem: async (sheet, id) => { 
                    if(confirm("確定刪除？")) { 
                        loading.value = true; 
                        try {
                            const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteData', id, sheet, key: USER_KEY.value }) }).then(r => r.json());
                            if (res.success) { showToast("已刪除"); fetchData(); } else handleApiError(res);
                        } catch (e) { showToast("網路錯誤", "error"); } finally { loading.value = false; }
                    } 
                },
                toggleWishDone,
                saveSettings: async () => { 
                    loading.value = true; 
                    try {
                        const res = await fetch(GAS_URL, { 
                            method: 'POST', body: JSON.stringify({ action: 'updateSettings', data: { ...settingForm.value, rates: localRates.value }, key: USER_KEY.value }) 
                        }).then(r => r.json());
                        if (res.success) { showToast("設定已儲存"); fetchData(); } else handleApiError(res);
                    } catch (e) { showToast("網路錯誤", "error"); } finally { loading.value = false; }
                },
                openGoogleMaps: (loc) => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`, '_blank'),
                linkify: (text) => text ? text.replace(/(\b(https?):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig, (url) => `<a href="${url}" target="_blank" class="text-blue-500 underline break-all">${url}</a>`) : "",
                parseImages, removeImage: (idx) => { if(currentTab.value==='expense') form.value.image=''; else form.value.image.splice(idx,1); },
                compressAndUpload, isItemSelected: (it, f) => (form.value[f] || "").split(',').includes(it),
                toggleSelection: (it, f) => { let c = (form.value[f] || "").split(',').filter(x => x); const i = c.indexOf(it); if (i > -1) c.splice(i, 1); else c.push(it); form.value[f] = c.join(','); },
                toggleTagFilter: (t) => { const i = selectedWishTags.value.indexOf(t); if (i > -1) selectedWishTags.value.splice(i, 1); else selectedWishTags.value.push(t); },
                openLightbox: (images, index) => {
                    const urls = Array.isArray(images) ? images : parseImages(images);
                    if (!urls || urls.length === 0) return;
                    lightboxUrls.value = urls; lightboxIndex.value = index; lightboxUrl.value = urls[index];
                    zoomScale.value = 1; offsetX.value = 0; offsetY.value = 0; lastScale.value = 1;
                },
                closeLightbox: () => { lightboxUrl.value = null; },
                prevPhoto, nextPhoto, handleTouchStartImg, handleTouchMoveImg, handleTouchEndImg,
                expandedItems, toggleExpand: (id) => { const i = expandedItems.value.indexOf(id); if (i > -1) expandedItems.value.splice(i, 1); else expandedItems.value.push(id); },
                isWishDone,
                insertTodoTag: () => {
                    const prefix = "- [ ] ";
                    if (!form.value.content) form.value.content = prefix;
                    else form.value.content += (form.value.content.endsWith('\n') ? '' : '\n') + prefix;
                    setTimeout(() => document.getElementById('wishContent')?.focus(), 50);
                },
                handleWishKeydown: (e) => {
                    if (e.key === 'Enter') {
                        const el = e.target; const start = el.selectionStart; const lastLine = el.value.substring(0, start).split('\n').pop();
                        if (lastLine.trim().startsWith('- [ ] ') || lastLine.trim().startsWith('- [x] ')) {
                            e.preventDefault(); const insertText = '\n- [ ] ';
                            form.value.content = el.value.substring(0, start) + insertText + el.value.substring(el.selectionEnd);
                            setTimeout(() => { el.selectionStart = el.selectionEnd = start + insertText.length; }, 0);
                        }
                    }
                },
                toggleSubTodo, 
                getCollapsedText,
                parseContentDetailed
            };
        }
    }).mount('#app');
}

function showErrorPage(msg) {
    document.body.innerHTML = `<div class="p-10 text-center flex flex-col items-center justify-center min-h-screen text-slate-500"><i class="fa-solid fa-circle-exclamation text-4xl text-red-400 mb-4"></i><h2 class="text-xl font-bold">${msg}</h2></div>`;
}

function updatePwaManifest(name, tripId, key, themeId) {
    const link = document.getElementById('manifest-link');
    if (!link) return;
    const themeColors = { 'spring': '#e7a8a8', 'summer': '#6d9bc3', 'autumn': '#d9a05b', 'winter': '#8da9c4' };
    const activeColor = themeColors[themeId] || '#e7a8a8';
    const manifest = {
        "name": name, "short_name": name,
        "start_url": `index.html?trip=${tripId}${key ? '&key='+key : ''}`,
        "display": "standalone", "background_color": "#f8fafc", "theme_color": activeColor,
        "icons": [{ "src": "https://rainchord.s3.ap-east-2.amazonaws.com/inventory/1768671480240_travel-bag.png", "sizes": "512x512", "type": "image/png" }]
    };
    const blob = new Blob([JSON.stringify(manifest)], {type: 'application/json'});
    link.href = URL.createObjectURL(blob);
    let metaTheme = document.querySelector('meta[name="theme-color"]');
    if (!metaTheme) { metaTheme = document.createElement('meta'); metaTheme.name = 'theme-color'; document.head.appendChild(metaTheme); }
    metaTheme.content = activeColor;
}

initPlatform();
