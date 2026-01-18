const { createApp, ref, computed, onMounted, watch } = Vue;
// 請確保此網址正確
const GAS_URL = "https://script.google.com/macros/s/AKfycbwTbYWXTcRVBGIXUiRY7sMJCxymVtyK4Y-E6TPSA9Wc6vS39-MjLzC7Iw3ziN9xA1Mk/exec"; 

createApp({
    setup() {
        let syncTimer = null;

// ==========================================
// 【修正：網址優先且嚴格的金鑰邏輯】
// ==========================================
const getInitialKey = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get('key');

    if (keyFromUrl !== null) {
        // 情境 A：網址有帶 key 參數 (不管是正確還是空的 ?key=)
        if (keyFromUrl.trim() !== "") {
            localStorage.setItem('travel_access_key', keyFromUrl);
            return keyFromUrl;
        } else {
            // 如果網址是 ?key= (空的)，視為登出，清除暫存
            localStorage.removeItem('travel_access_key');
            return "";
        }
    } else {
        // 情境 B：網址完全沒有 key 參數 (例如直接輸入 index.html)
        // 此處你可以決定：
        // 1. 要不要從暫存拿？如果要像你說的「按 Enter (重新整理) 就回到沒有 KEY」，
        //    那就直接回傳空字串，並且不使用 localStorage。
        
        // 依照你的需求「網址沒帶 KEY 就回到沒有 KEY 的狀態」：
        localStorage.removeItem('travel_access_key'); // 強制清空
        return "";
    }
};

        const USER_KEY = ref(getInitialKey());

        // 【修正 2: 嚴格判斷 isAdmin】
        // 確保只有當金鑰真正存在且不是空字串時才顯示按鈕
        const isAdmin = computed(() => {
            const k = USER_KEY.value;
            return k !== null && k !== undefined && String(k).trim() !== "" && String(k) !== "null";
        });

        // --- 1. 基礎狀態 ---
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
        
        // --- 2. 燈箱與手勢狀態 ---
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
        const settingForm = ref({ travelers: "", categories: "", wishTags: "", paymentMethods: "現金, 信用卡" });
        const localRates = ref([]);
        
        const tabNames = { itinerary:'行程', expense:'記帳', wish:'許願', setting:'設定' };
        const tabIcons = { itinerary:'fa-calendar-days', expense:'fa-wallet', wish:'fa-wand-magic-sparkles', setting:'fa-gear' };
		
		// ==========================================
        // 【修正 3: 處理金鑰失效自動隱藏】
        // ==========================================
        const handleApiError = (res) => {
            if (res && res.message && (res.message.includes("金鑰") || res.message.includes("權限"))) {
                alert("權限驗證失敗，管理功能已停用");
                USER_KEY.value = ""; // 這裡一變，isAdmin 就會變 false，按鈕立即消失
                localStorage.removeItem('travel_access_key');
            } else {
                alert("儲存失敗：" + (res.message || "未知錯誤"));
            }
        };

        // --- 3. 輔助工具 ---
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

        // --- 4. 計算屬性 ---
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

        // --- 5. 燈箱與分頁核心手勢邏輯 ---
        const handleSwipe = () => {
            if (zoomScale.value > 1.1) return; 
            const swipeThreshold = 100;
            const verticalLimit = 40;
            const diffX = touchState.value.startX - touchState.value.endX;
            const diffY = touchState.value.startY - touchState.value.endY;

            if (Math.abs(diffX) > swipeThreshold && 
                Math.abs(diffY) < verticalLimit && 
                Math.abs(diffX) > Math.abs(diffY) * 3) {
                
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
            } else if (zoomScale.value <= 1.05) {
                zoomScale.value = 1; lastScale.value = 1; offsetX.value = 0; offsetY.value = 0;
            }
        };

        // --- 6. 圖片與資料處理 ---
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
                        body: JSON.stringify({ 
                            action: 'uploadImage', 
                            base64, 
                            fileName: `${Date.now()}.webp`, 
                            fileType: 'image/webp',
                            key: USER_KEY.value // 補上金鑰
                        })
                    }).then(r => r.json());
                    
                    if (res.success) {
                        if (currentTab.value === 'expense') form.value.image = res.url;
                        else {
                            if (!Array.isArray(form.value.image)) form.value.image = [];
                            form.value.image.push(res.url);
                        }
                    } else {
                        alert("上傳失敗：" + (res.message || "權限不足"));
                    }
                } catch (e) { console.error(e); }
                uploadProgress.value.current++;
            }
            uploading.value = false;
        };

const fetchData = async () => {
            if (!allData.value.itinerary.length) loading.value = true; 
            try {
                // 如果沒有 Key，就不帶 key 參數，避免 GAS 報錯
                const url = isAdmin.value ? `${GAS_URL}?key=${USER_KEY.value}` : GAS_URL;
                const res = await fetch(url).then(r => r.json());
                
                allData.value = res;
                settingForm.value = { ...res.settings };
                localRates.value = typeof res.settings.rates === 'string' ? JSON.parse(res.settings.rates) : (res.settings.rates || []);
                localStorage.setItem('travel_pro_cache', JSON.stringify(res));
            } catch (e) { 
                console.error("Fetch error:", e); 
            } finally { 
                loading.value = false; 
            }
        };

const submitForm = async () => {
            if (uploading.value) return alert("圖片上傳中...");
            loading.value = true;
            try {
                let dataToSave = { ...form.value };
                // ... 記帳邏輯保持不變 ...
                
                const action = isEditing.value ? 'updateData' : 'addData';
                const sheet = { itinerary: 'Itinerary', expense: 'Expenses', wish: 'Wishes' }[currentTab.value];
                
                const res = await fetch(GAS_URL, { 
                    method: 'POST', 
                    body: JSON.stringify({ 
                        action, 
                        data: dataToSave, 
                        id: form.value.id || null, 
                        sheet,
                        key: USER_KEY.value
                    }) 
                }).then(r => r.json());

                if (res.success) {
                    showModal.value = false;
                    fetchData();
                } else {
                    handleApiError(res); // 使用統一錯誤處理
                    fetchData();
                }
            } catch (e) { 
                alert("網路連線錯誤"); 
            } finally { 
                loading.value = false; 
            }
        };

        const prevPhoto = () => {
            if (zoomScale.value > 1.1) return; 
            if (lightboxUrls.value.length === 0) return;
            lightboxIndex.value = (lightboxIndex.value - 1 + lightboxUrls.value.length) % lightboxUrls.value.length;
            lightboxUrl.value = lightboxUrls.value[lightboxIndex.value];
        };
        const nextPhoto = () => {
            if (zoomScale.value > 1.1) return; 
            if (lightboxUrls.value.length === 0) return;
            lightboxIndex.value = (lightboxIndex.value + 1) % lightboxUrls.value.length;
            lightboxUrl.value = lightboxUrls.value[lightboxIndex.value];
        };

// --- 7. 生命周期與全局監聽 ---
        onMounted(() => {
            // ==========================================
            // 【新增：PWA 動態 Manifest 邏輯】
            // ==========================================
            if (USER_KEY.value) {
                const manifestElem = document.getElementById('manifest-link');
                if (manifestElem) {
                    const adminManifest = {
                        "name": "拾光旅圖 (管理模式)",
                        "short_name": "旅圖管理",
                        "start_url": `index.html?key=${USER_KEY.value}`, // 自動帶入當前金鑰
                        "display": "standalone",
                        "background_color": "#f8fafc",
                        "theme_color": "#6d9bc3",
                        "icons": [
                            {
                                "src": "https://rainchord.s3.ap-east-2.amazonaws.com/inventory/1768671480240_travel-bag.png",
                                "sizes": "512x512",
                                "type": "image/png",
                                "purpose": "any maskable"
                            }
                        ]
                    };
                    const blob = new Blob([JSON.stringify(adminManifest)], { type: 'application/json' });
                    manifestElem.setAttribute('href', URL.createObjectURL(blob));
                }
            }

            // --- 原有的快取載入與事件監聽 ---
            const cachedData = localStorage.getItem('travel_pro_cache');
            if (cachedData) {
                try {
                    const res = JSON.parse(cachedData);
                    allData.value = res;
                    settingForm.value = { ...res.settings };
                    localRates.value = typeof res.settings.rates === 'string' ? JSON.parse(res.settings.rates) : (res.settings.rates || []);
                } catch (e) { console.error("快取解析失敗"); }
            }
            fetchData();

            // 鍵盤與觸控監聽 (保持不變)
            window.addEventListener('keydown', (e) => {
                if (lightboxUrl.value) {
                    if (e.key === 'ArrowLeft') prevPhoto();
                    if (e.key === 'ArrowRight') nextPhoto();
                    if (e.key === 'Escape') lightboxUrl.value = null;
                }
            });

            window.addEventListener('touchstart', (e) => {
                const target = e.target;
                const isInsideTable = target.closest('.table-container');
                const isInsideItineraryDate = target.closest('.itinerary-date-filter');
                const isInsideWishTags = target.closest('.wish-tags-container');
                const isInsideCardSlider = target.closest('.card-image-slider'); 
                const isInput = target.closest('textarea') || target.closest('input');

                if (lightboxUrl.value || showModal.value || isInsideTable || isInsideItineraryDate || isInsideWishTags || isInsideCardSlider || isInput) {
                    touchState.value.startX = 0; 
                    return;
                }
                touchState.value.startX = e.touches[0].clientX;
                touchState.value.startY = e.touches[0].clientY;
            }, { passive: true });

            window.addEventListener('touchend', (e) => {
                if (lightboxUrl.value || showModal.value || touchState.value.startX === 0) return;
                touchState.value.endX = e.changedTouches[0].clientX;
                touchState.value.endY = e.changedTouches[0].clientY;
                handleSwipe();
            }, { passive: true });
        });

        // --- 8. 待辦與功能函數 ---
        const insertTodoTag = () => {
            const prefix = "- [ ] ";
            if (!form.value.content) form.value.content = prefix;
            else form.value.content += (form.value.content.endsWith('\n') ? '' : '\n') + prefix;
            setTimeout(() => document.getElementById('wishContent')?.focus(), 50);
        };

        const handleWishKeydown = (e) => {
            if (e.key === 'Enter') {
                const el = e.target;
                const start = el.selectionStart;
                const lastLine = el.value.substring(0, start).split('\n').pop();
                if (lastLine.startsWith('- [ ] ') || lastLine.startsWith('- [x] ')) {
                    e.preventDefault();
                    const insertText = '\n- [ ] ';
                    form.value.content = el.value.substring(0, start) + insertText + el.value.substring(el.selectionEnd);
                    setTimeout(() => { el.selectionStart = el.selectionEnd = start + insertText.length; }, 0);
                }
            }
        };

// --- 修正後的許願清單待辦勾選 ---
const toggleSubTodo = async (wish, index) => {
    // 1. 先確認是否有權限，沒權限直接擋掉，不給勾
    if (!USER_KEY.value) {
        alert("權限不足，無法勾選");
        return;
    }

    // 取得原本的狀態（備份，萬一失敗要恢復）
    const todos = parseTodos(wish.todo);
    const originalTodoText = wish.todo;
    
    // 2. 前端先反應 (樂觀更新)
    todos[index].done = !todos[index].done;
    const newTodoText = todos.map(t => `- [${t.done ? 'x' : ' '}] ${t.content}`).join('\n');
    wish.todo = newTodoText;

    loading.value = true;
    try {
        const res = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'updateData',
                data: { ...wish, todo: newTodoText },
                id: wish.id,
                sheet: 'Wishes',
                key: USER_KEY.value
            })
        }).then(r => r.json());

        if (res.success) {
            // 成功：重新整理數據以確保同步
            await fetchData();
        } else {
            // 失敗：權限不足或金鑰失效
            handleApiError(res);
            // 【關鍵】將前端狀態恢復成原始資料
            wish.todo = originalTodoText;
        }
    } catch (e) {
        alert("網路連線錯誤");
        // 發生意外時也要恢復原狀
        wish.todo = originalTodoText;
    } finally {
        loading.value = false;
    }
};

        const fetchDataSilently = async () => {
            try {
                const res = await fetch(`${GAS_URL}?key=${USER_KEY.value}`).then(r => r.json());
                allData.value = res;
                localStorage.setItem('travel_pro_cache', JSON.stringify(res));
            } catch (e) { console.log("靜默同步失敗"); }
        };

        return { 
            isAdmin, // 重要：返回給 HTML 使用
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
            const res = await fetch(GAS_URL, { 
                method: 'POST', 
                body: JSON.stringify({ action: 'deleteData', id, sheet, key: USER_KEY.value }) 
            }).then(r => r.json());
            
            if (res.success) {
                fetchData(); 
            } else {
                handleApiError(res); // <-- 改成這個
                fetchData();
            }
        } catch (e) { alert("網路連線錯誤"); }
        finally { loading.value = false; }
    } 
},
toggleWishDone: async (wish) => { 
    loading.value = true; 
    try {
        const res = await fetch(GAS_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
                action: 'updateData', 
                data: { ...wish, isDone: !isWishDone(wish) }, 
                id: wish.id, 
                sheet: 'Wishes', 
                key: USER_KEY.value 
            }) 
        }).then(r => r.json());

        if (res.success) {
            fetchData(); 
        } else {
            handleApiError(res); // <-- 改成這個
            fetchData();
        }
    } catch (e) { alert("網路連線錯誤"); }
    finally { loading.value = false; }
},
saveSettings: async () => { 
    loading.value = true; 
    try {
        const res = await fetch(GAS_URL, { 
            method: 'POST', 
            body: JSON.stringify({ 
                action: 'updateSettings', 
                data: { ...settingForm.value, rates: localRates.value },
                key: USER_KEY.value 
            }) 
        }).then(r => r.json());

        if (res.success) {
            alert("設定已儲存"); 
            fetchData();
        } else {
            handleApiError(res); // <-- 改成這個
        }
    } catch (e) { alert("網路連線錯誤"); }
    finally { loading.value = false; }
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
                lightboxUrls.value = urls;
                lightboxIndex.value = index;
                lightboxUrl.value = urls[index];
                zoomScale.value = 1; offsetX.value = 0; offsetY.value = 0; lastScale.value = 1;
            },
            closeLightbox: () => { lightboxUrl.value = null; zoomScale.value = 1; },
            prevPhoto, nextPhoto,
            handleTouchStartImg, handleTouchMoveImg, handleTouchEndImg,
            expandedItems, toggleExpand: (id) => { const i = expandedItems.value.indexOf(id); if (i > -1) expandedItems.value.splice(i, 1); else expandedItems.value.push(id); },
            isWishDone, insertTodoTag, handleWishKeydown, toggleSubTodo,
            hasTodos: (text) => text && text.includes('- ['),
            parseTodos: (text) => {
                if (!text) return [];
                return text.split('\n').filter(line => line.trim().startsWith('- [')).map(line => ({
                    done: line.trim().startsWith('- [x]'),
                    text: line.replace(/- \[[x ]\]/, '').trim()
                }));
            }
        };
    }
}).mount('#app');
