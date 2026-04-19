// ============================================================
// Firebase 設定
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
    getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
    collection, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD5IjcEMH0XzPhIiosenWjE2qVTCuKA3cI",
    authDomain: "travel-pro-pwa.firebaseapp.com",
    projectId: "travel-pro-pwa",
    storageBucket: "travel-pro-pwa.firebasestorage.app",
    messagingSenderId: "632960809665",
    appId: "1:632960809665:web:78661b03b2751093fd3240",
    measurementId: "G-239FVGTWX6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ============================================================
// ImgBB 圖片上傳（透過 GAS 中轉，保護 API Key）
// ============================================================
const GAS_UPLOAD_URL = "https://script.google.com/macros/s/AKfycbzNS0ICDDl1RkpZfi42nZWE2Toprs7DZzMzRGwS4BnQ4J2fSzKWNMaJDNPlq9VZcsrnOg/exec";

async function uploadToImgBB(base64Data) {
    // 1. 處理 Base64，確保不含 data:image/jpeg;base64, 等前綴
    const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    
    // 2. 使用 URLSearchParams 封裝，這會以 application/x-www-form-urlencoded 格式送出
    // 這是關鍵：它被瀏覽器視為簡單請求，不會觸發 CORS Preflight
    const params = new URLSearchParams();
    params.append('image', base64);

    try {
        const res = await fetch(GAS_UPLOAD_URL, {
            method: 'POST',
            body: params, // 直接傳送 params 物件
            // 🚩 這裡絕對不要寫 headers: { 'Content-Type': '...' }
        });

        // GAS 回傳的是 JSON，直接解析即可
        const data = await res.json();
        
        if (data.success) {
            console.log('上傳成功:', data.url);
            return data.url;
        } else {
            throw new Error(data.error || '未知錯誤');
        }
    } catch (error) {
        console.error('GAS 中轉上傳失敗:', error);
        throw new Error('圖片上傳失敗，請稍後再試');
    }
}

// ============================================================
// 平台初始化
// ============================================================
const { createApp, ref, computed, onMounted } = Vue;

async function initPlatform() {
    const urlParams = new URLSearchParams(window.location.search);
    const tripIdFromUrl = urlParams.get('trip');
    const keyFromUrl = urlParams.get('key');
    const lastTripId = localStorage.getItem('last_active_trip');
    const isAppJustStarted = !sessionStorage.getItem('session_initialized');

    if (isAppJustStarted && lastTripId && tripIdFromUrl !== lastTripId) {
        sessionStorage.setItem('session_initialized', 'true');
        const savedKey = localStorage.getItem(`key_${lastTripId}`) || "";
        window.location.replace(`index.html?trip=${lastTripId}${savedKey ? '&key=' + savedKey : ''}`);
        return;
    }
    sessionStorage.setItem('session_initialized', 'true');

    const activeTripId = tripIdFromUrl || lastTripId;
    if (!activeTripId) { showErrorPage("請提供行程 ID"); return; }

    if (keyFromUrl !== null) {
        if (keyFromUrl.trim() !== "") localStorage.setItem(`key_${activeTripId}`, keyFromUrl);
        else localStorage.removeItem(`key_${activeTripId}`);
    }
    localStorage.setItem('last_active_trip', activeTripId);
    const currentKey = localStorage.getItem(`key_${activeTripId}`) || "";
    updatePwaManifest("拾光旅圖", activeTripId, currentKey, 'spring');

    try {
        const catalogDoc = await getDoc(doc(db, 'catalog', activeTripId));
        if (!catalogDoc.exists()) { showErrorPage(`找不到行程: ${activeTripId}`); return; }
        const catalogData = catalogDoc.data();
        const previewTheme = urlParams.get('preview_theme');
        const finalTheme = previewTheme || catalogData.theme_id || 'spring';
        updatePwaManifest("拾光旅圖", activeTripId, currentKey, finalTheme);
        startApp(catalogData, activeTripId, finalTheme);
    } catch (err) {
        console.error(err);
        showErrorPage("連線錯誤");
    }
}

function startApp(BOOT_CONFIG, tripId, themeOverride) {
    const theme = themeOverride || BOOT_CONFIG.theme_id || 'spring';
    document.documentElement.setAttribute('data-theme', theme);
    document.title = BOOT_CONFIG.display_name || '拾光旅圖';

    createApp({
        setup() {
            const USER_KEY = ref(localStorage.getItem(`key_${tripId}`) || "");
            const isAdmin = computed(() => USER_KEY.value && USER_KEY.value.trim() === (BOOT_CONFIG.admin_key || ""));

            const toast = ref({ show: false, msg: '', type: 'success' });
            const showToast = (msg, type = 'success') => {
                toast.value = { show: true, msg, type };
                setTimeout(() => { toast.value.show = false; }, 3000);
            };

            const identity = ref(JSON.parse(localStorage.getItem('travel_pro_identity') || 'null'));
            const myTrips = ref([]);
            const isSyncingTrips = ref(false);
            const tempUser = ref("");
            const tempKey = ref("");
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

            const tabNames = { itinerary: '行程', expense: '記帳', wish: '許願', setting: '設定' };
            const tabIcons = { itinerary: 'fa-calendar-days', expense: 'fa-wallet', wish: 'fa-wand-magic-sparkles', setting: 'fa-gear' };

            const categoryColorMap = computed(() => {
                const map = {};
                const categories = [...new Set((allData.value.itinerary || []).map(i => i.category).filter(Boolean))];
                categories.forEach((cat, index) => { map[cat] = `cat-color-${index % 6}`; });
                return map;
            });
            const getCategoryColorClass = (category) => !category ? 'cat-color-0' : categoryColorMap.value[category] || 'cat-color-0';

            const isWishDone = (wish) => {
                if (!wish) return false;
                if (typeof wish.isDone === 'boolean') return wish.isDone;
                return String(wish.isDone).toLowerCase() === 'true';
            };

            const getDirectImageUrl = (url) => {
                if (!url || typeof url !== 'string') return '';
                // 相容舊的 Google Drive 連結
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
                return list
                    .filter(i => filterDate.value ? rawToDateStr(i.day) === filterDate.value : true)
                    .sort((a, b) => {
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
                }).sort((a, b) => rawToDateStr(b.date).localeCompare(rawToDateStr(a.date)) || (Number(b.id) - Number(a.id)));
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
                    return matchTags && (!query || (wish.content || "").toLowerCase().includes(query) || (wish.tag && wish.tag.toLowerCase().includes(query)));
                });
                return results.sort((a, b) => {
                    const statusA = isWishDone(a) ? 1 : 0, statusB = isWishDone(b) ? 1 : 0;
                    if (statusA !== statusB) return statusA - statusB;
                    const parseDate = (obj) => { const t = obj.updatetime || obj.updateTime || ""; if (!t) return 0; const d = new Date(String(t).replace(/-/g, '/')); return isNaN(d.getTime()) ? 0 : d.getTime(); };
                    const tA = parseDate(a), tB = parseDate(b);
                    if (tB !== tA) return tB - tA;
                    return (BigInt(String(b.id || 0).replace(/\D/g, '')) > BigInt(String(a.id || 0).replace(/\D/g, ''))) ? 1 : -1;
                });
            });

            const handleSwipe = () => {
                if (zoomScale.value > 1.1) return;
                const diffX = touchState.value.startX - touchState.value.endX;
                const diffY = touchState.value.startY - touchState.value.endY;
                if (Math.abs(diffX) > 100 && Math.abs(diffY) < 40 && Math.abs(diffX) > Math.abs(diffY) * 3) {
                    const tabs = Object.keys(tabNames);
                    let ci = tabs.indexOf(currentTab.value);
                    if (diffX > 0 && ci < tabs.length - 1) currentTab.value = tabs[ci + 1];
                    else if (diffX < 0 && ci > 0) currentTab.value = tabs[ci - 1];
                }
            };

            const handleTouchStartImg = (e) => {
                if (e.touches.length === 2) {
                    touchStartDist.value = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                } else if (e.touches.length === 1) {
                    imgTouchState.value.startX = e.touches[0].pageX;
                    imgTouchState.value.startY = e.touches[0].pageY;
                    if (zoomScale.value > 1) { isDragging.value = true; touchStartPoint.value = { x: e.touches[0].pageX - offsetX.value, y: e.touches[0].pageY - offsetY.value }; }
                }
            };
            const handleTouchMoveImg = (e) => {
                if (e.touches.length === 2) {
                    const d = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                    zoomScale.value = Math.min(Math.max((d / touchStartDist.value) * lastScale.value, 1), 4);
                } else if (e.touches.length === 1 && isDragging.value) {
                    offsetX.value = e.touches[0].pageX - touchStartPoint.value.x;
                    offsetY.value = e.touches[0].pageY - touchStartPoint.value.y;
                }
            };
            const handleTouchEndImg = (e) => {
                isDragging.value = false; lastScale.value = zoomScale.value;
                if (zoomScale.value <= 1.1) {
                    const diffX = imgTouchState.value.startX - e.changedTouches[0].pageX;
                    if (Math.abs(diffX) > 50) { if (diffX > 0) nextPhoto(); else prevPhoto(); }
                    zoomScale.value = 1; lastScale.value = 1; offsetX.value = 0; offsetY.value = 0;
                }
            };

            const resizeImage = (file) => new Promise((resolve) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (e) => {
                    const img = new Image();
                    img.src = e.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let w = img.width, h = img.height, max = 1000;
                        if (w > h && w > max) { h *= max / w; w = max; } else if (h > max) { w *= max / h; h = max; }
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/webp', 0.8));
                    };
                };
            });

            // ── 圖片上傳（透過 GAS 中轉）──
            const compressAndUpload = async (event) => {
                const files = event.target.files;
                if (!files.length) return;
                uploading.value = true;
                uploadProgress.value = { current: 0, total: files.length };
                for (let file of files) {
                    try {
                        const base64 = await resizeImage(file);
                        const url = await uploadToImgBB(base64);
                        if (currentTab.value === 'expense') form.value.image = url;
                        else { if (!Array.isArray(form.value.image)) form.value.image = []; form.value.image.push(url); }
                    } catch (e) { console.error(e); showToast("圖片上傳失敗", "error"); }
                    uploadProgress.value.current++;
                }
                uploading.value = false;
            };

            // ── 讀取資料（Firestore）──
            const fetchData = async () => {
                if (pendingWishes.size > 0) return;
                if (!allData.value.itinerary.length) loading.value = true;
                try {
                    const [itSnap, expSnap, wishSnap, settSnap] = await Promise.all([
                        getDocs(collection(db, 'trips', tripId, 'itinerary')),
                        getDocs(collection(db, 'trips', tripId, 'expenses')),
                        getDocs(collection(db, 'trips', tripId, 'wishes')),
                        getDoc(doc(db, 'trips', tripId, 'settings', 'main'))
                    ]);
                    const settings = settSnap.exists() ? settSnap.data() : {};
                    allData.value = {
                        itinerary: itSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                        expenses: expSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                        wishes: wishSnap.docs.map(d => ({ id: d.id, ...d.data() })),
                        settings
                    };
                    settingForm.value = {
                        travelers: settings.travelers || "",
                        categories: settings.categories || "",
                        wishTags: settings.wishTags || "",
                        paymentMethods: settings.paymentMethods || "現金,信用卡"
                    };
                    localRates.value = Array.isArray(settings.rates) ? settings.rates : (typeof settings.rates === 'string' ? JSON.parse(settings.rates) : []);
                    localStorage.setItem(`cache_${tripId}`, JSON.stringify(allData.value));
                } catch (e) { console.error("Fetch error:", e); }
                finally { loading.value = false; }
            };

            // ── 儲存設定 ──
            const saveSettings = async () => {
                loading.value = true;
                try {
                    await setDoc(doc(db, 'trips', tripId, 'settings', 'main'), { ...settingForm.value, rates: localRates.value });
                    showToast("設定已儲存"); fetchData();
                } catch (e) { showToast("儲存失敗", "error"); }
                finally { loading.value = false; }
            };

            // ── 刪除 ──
            const deleteItem = async (sheet, id) => {
                if (!confirm("確定刪除？")) return;
                loading.value = true;
                try {
                    const colName = { Itinerary: 'itinerary', Expenses: 'expenses', Wishes: 'wishes' }[sheet] || sheet.toLowerCase();
                    await deleteDoc(doc(db, 'trips', tripId, colName, id));
                    showToast("已刪除"); fetchData();
                } catch (e) { showToast("刪除失敗", "error"); }
                finally { loading.value = false; }
            };

            // ── 提交表單 ──
            const submitForm = async () => {
                if (uploading.value) return showToast("圖片上傳中...", "error");
                loading.value = true;
                try {
                    const colName = { itinerary: 'itinerary', expense: 'expenses', wish: 'wishes' }[currentTab.value];

                    if (currentTab.value === 'expense') {
                        const selectedRate = localRates.value.find(r => r.code === form.value.currency);
                        form.value.twd = Math.round(form.value.amount * (selectedRate ? Number(selectedRate.rate) : 1));

                        if (!isEditing.value) {
                            const debtors = (form.value.debtor || "").split(',').filter(x => x);
                            if (debtors.length > 1) {
                                const splitAmount = Math.round((form.value.amount / debtors.length) * 100) / 100;
                                const splitTwd = Math.round(form.value.twd / debtors.length);
                                await Promise.all(debtors.map(person => {
                                    const d = { ...form.value, amount: splitAmount, twd: splitTwd, debtor: person, item: `${form.value.item} (${person}均分)`, createdAt: serverTimestamp() };
                                    delete d.id;
                                    return addDoc(collection(db, 'trips', tripId, colName), d);
                                }));
                                showToast(`已拆分為 ${debtors.length} 筆均分帳目`);
                                showModal.value = false; fetchData(); loading.value = false; return;
                            }
                        }
                    }

                    const dataToSave = { ...form.value };
                    if (Array.isArray(dataToSave.image)) dataToSave.image = JSON.stringify(dataToSave.image);

                    if (isEditing.value && form.value.id) {
                        const { id, ...rest } = dataToSave;
                        await updateDoc(doc(db, 'trips', tripId, colName, id), { ...rest, updatedAt: serverTimestamp() });
                    } else {
                        delete dataToSave.id;
                        await addDoc(collection(db, 'trips', tripId, colName), { ...dataToSave, createdAt: serverTimestamp() });
                    }
                    showToast(isEditing.value ? "更新成功" : "儲存成功");
                    showModal.value = false; fetchData();
                } catch (e) { console.error(e); showToast("網路連線錯誤", "error"); }
                finally { loading.value = false; }
            };

            // ── 許願 debounce 同步 ──
            const triggerSync = (wish) => {
                pendingWishes.add(wish.id);
                if (syncTimer) clearTimeout(syncTimer);
                syncTimer = setTimeout(async () => {
                    const ids = Array.from(pendingWishes); pendingWishes.clear();
                    for (const id of ids) {
                        const target = allData.value.wishes.find(w => w.id === id);
                        if (!target) continue;
                        try { const { id: docId, ...rest } = target; await updateDoc(doc(db, 'trips', tripId, 'wishes', docId), { ...rest, updateTime: new Date().toISOString() }); }
                        catch (e) { console.error("Sync failed for wish:", id); }
                    }
                }, 1500);
            };

            const toggleWishDone = (wish) => { if (!isAdmin.value) return showToast("權限不足", "error"); wish.isDone = !isWishDone(wish); triggerSync(wish); };
            const toggleSubTodo = (wish, lineIndex) => {
                if (!isAdmin.value) return showToast("權限不足，無法勾選", "error");
                const lines = wish.content.split('\n');
                if (lines[lineIndex].trim().startsWith('- [x]')) lines[lineIndex] = lines[lineIndex].replace('- [x]', '- [ ]');
                else if (lines[lineIndex].trim().startsWith('- [ ]')) lines[lineIndex] = lines[lineIndex].replace('- [ ]', '- [x]');
                wish.content = lines.join('\n'); triggerSync(wish);
            };

            // ── 我的行程清單 ──
            const fetchMyTrips = async () => {
                if (!identity.value) return;
                isSyncingTrips.value = true;
                try {
                    const snap = await getDocs(collection(db, 'catalog'));
                    myTrips.value = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t =>
                        t.nickname && t.nickname.toLowerCase() === identity.value.user.toLowerCase() &&
                        t.secret_key === identity.value.key
                    );
                } catch (e) { console.error("同步行程清單失敗", e); }
                finally { isSyncingTrips.value = false; }
            };

            const saveAndSyncIdentity = () => {
                if (!tempUser.value || !tempKey.value) return showToast("請填寫完整帳號與金鑰", "error");
                identity.value = { user: tempUser.value.toLowerCase().trim(), key: tempKey.value.trim() };
                localStorage.setItem('travel_pro_identity', JSON.stringify(identity.value));
                showToast("身分已登錄，正在同步清單"); fetchMyTrips();
            };

            const switchTrip = (trip) => { window.location.href = `index.html?trip=${trip.trip_id}&key=${trip.admin_key}`; };
            const prevPhoto = () => { if (zoomScale.value > 1.1 || !lightboxUrls.value.length) return; lightboxIndex.value = (lightboxIndex.value - 1 + lightboxUrls.value.length) % lightboxUrls.value.length; lightboxUrl.value = lightboxUrls.value[lightboxIndex.value]; };
            const nextPhoto = () => { if (zoomScale.value > 1.1 || !lightboxUrls.value.length) return; lightboxIndex.value = (lightboxIndex.value + 1) % lightboxUrls.value.length; lightboxUrl.value = lightboxUrls.value[lightboxIndex.value]; };

            onMounted(() => {
                if (identity.value) fetchMyTrips();
                const cached = localStorage.getItem(`cache_${tripId}`);
                if (cached) { try { allData.value = JSON.parse(cached); } catch (e) {} }
                fetchData();
                window.addEventListener('keydown', (e) => { if (lightboxUrl.value) { if (e.key === 'ArrowLeft') prevPhoto(); if (e.key === 'ArrowRight') nextPhoto(); if (e.key === 'Escape') lightboxUrl.value = null; } });
                window.addEventListener('touchstart', (e) => {
                    const t = e.target;
                    const ok = !t.closest('.table-container') && !t.closest('.itinerary-date-filter') && !t.closest('.wish-tags-container') && !t.closest('.card-image-slider') && !t.closest('textarea') && !t.closest('input') && !showModal.value && !lightboxUrl.value;
                    if (ok) { touchState.value.startX = e.touches[0].clientX; touchState.value.startY = e.touches[0].clientY; } else touchState.value.startX = 0;
                }, { passive: true });
                window.addEventListener('touchend', (e) => { if (!touchState.value.startX) return; touchState.value.endX = e.changedTouches[0].clientX; touchState.value.endY = e.changedTouches[0].clientY; handleSwipe(); }, { passive: true });
            });

            const parseContentDetailed = (text) => { if (!text) return []; return text.split('\n').map((line, index) => { const isTodo = line.trim().startsWith('- [ ]') || line.trim().startsWith('- [x]'); return { id: index, isTodo, done: line.trim().startsWith('- [x]'), text: isTodo ? line.replace(/- \[[x ]\]/, '').trim() : line }; }); };
            const getCollapsedText = (text) => { if (!text) return ""; return text.replace(/- \[[x ]\]/g, '').replace(/\n/g, ' '); };

            return {
                identity, myTrips, isSyncingTrips, tempUser, tempKey, saveAndSyncIdentity, switchTrip, fetchMyTrips,
                isAdmin, toast, showToast, categoryColorMap, getCategoryColorClass,
                currentTab, loading, uploading, uploadProgress, allData, tabNames, tabIcons,
                filteredItinerary, sortedExpensesByFilter, filteredTotalTWD, filteredWishes,
                availableDates: computed(() => [...new Set((allData.value.itinerary || []).map(i => rawToDateStr(i.day)))].filter(d => d && !d.includes('1899')).sort()),
                filterDate, debtFilter, showModal, isEditing, form,
                travelersAndCats: computed(() => ({
                    travelers: (settingForm.value.travelers || "").split(',').filter(x => x),
                    cats: (settingForm.value.categories || "").split(',').filter(x => x),
                    tags: (settingForm.value.wishTags || "").split(',').filter(x => x),
                    paymentMethods: (settingForm.value.paymentMethods || "現金,信用卡").split(',').filter(x => x)
                })),
                localRates, settingForm, selectedWishTags, wishSearchQuery, lightboxUrl, lightboxUrls, zoomScale, zoomStyle,
                openAddModal: () => {
                    isEditing.value = false;
                    const today = new Date().toISOString().split('T')[0];
                    const ts = (settingForm.value.travelers || "").split(',').filter(x => x);
                    if (currentTab.value === 'itinerary') form.value = { day: today, time: '', category: '景點', content: '', location: '', remark: '', duration: 1, image: [] };
                    else if (currentTab.value === 'expense') form.value = { date: today, item: '', amount: 0, currency: localRates.value[0]?.code || 'TWD', payer: ts[0] || "", debtor: ts[0] || "", paymentMethod: "現金", remark: '', image: "" };
                    else form.value = { tag: '', content: '', payer: ts[0] || "", isDone: false, image: [] };
                    showModal.value = true;
                },
                openEditModal: (item) => {
                    isEditing.value = true; form.value = JSON.parse(JSON.stringify(item));
                    const parsed = parseImages(item.image);
                    form.value.image = (currentTab.value === 'expense') ? (parsed[0] || "") : parsed;
                    if (form.value.day) form.value.day = rawToDateStr(form.value.day);
                    if (form.value.date) form.value.date = rawToDateStr(form.value.date);
                    showModal.value = true;
                },
                handlePayerSelect: (t) => { form.value.payer = t; if (currentTab.value === 'expense') form.value.debtor = t; },
                submitForm, fetchData,
                formatDisplayDate: (d) => rawToDateStr(d).split('-').slice(1).join('/'),
                formatDisplayTime: (t) => t ? String(t).padStart(4, '0').replace(/(..)(..)/, '$1:$2') : '--:--',
                getWeekday: (d) => d ? ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][new Date(d).getDay()] : "",
                deleteItem, toggleWishDone, saveSettings,
                openGoogleMaps: (loc) => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`, '_blank'),
                linkify: (text) => {
                    if (!text) return "";
                    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');
                    return escaped.replace(/(\b(https?):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig, (url) => `<a href="${url}" target="_blank" class="text-blue-500 underline break-all">${url}</a>`);
                },
                parseImages, removeImage: (idx) => { if (currentTab.value === 'expense') form.value.image = ''; else form.value.image.splice(idx, 1); },
                compressAndUpload,
                isItemSelected: (it, f) => (form.value[f] || "").split(',').includes(it),
                toggleSelection: (it, f) => { let c = (form.value[f] || "").split(',').filter(x => x); const i = c.indexOf(it); if (i > -1) c.splice(i, 1); else c.push(it); form.value[f] = c.join(','); },
                toggleTagFilter: (t) => { const i = selectedWishTags.value.indexOf(t); if (i > -1) selectedWishTags.value.splice(i, 1); else selectedWishTags.value.push(t); },
                openLightbox: (images, index) => {
                    const urls = Array.isArray(images) ? images : parseImages(images);
                    if (!urls || !urls.length) return;
                    lightboxUrls.value = urls; lightboxIndex.value = index; lightboxUrl.value = urls[index];
                    zoomScale.value = 1; offsetX.value = 0; offsetY.value = 0; lastScale.value = 1;
                },
                closeLightbox: () => { lightboxUrl.value = null; },
                prevPhoto, nextPhoto, handleTouchStartImg, handleTouchMoveImg, handleTouchEndImg,
                expandedItems, toggleExpand: (id) => { const i = expandedItems.value.indexOf(id); if (i > -1) expandedItems.value.splice(i, 1); else expandedItems.value.push(id); },
                isWishDone,
                insertTodoTag: () => { const p = "- [ ] "; if (!form.value.content) form.value.content = p; else form.value.content += (form.value.content.endsWith('\n') ? '' : '\n') + p; setTimeout(() => document.getElementById('wishContent')?.focus(), 50); },
                handleWishKeydown: (e) => {
                    if (e.key === 'Enter') {
                        const el = e.target; const start = el.selectionStart; const lastLine = el.value.substring(0, start).split('\n').pop();
                        if (lastLine.trim().startsWith('- [ ] ') || lastLine.trim().startsWith('- [x] ')) {
                            e.preventDefault(); const ins = '\n- [ ] ';
                            form.value.content = el.value.substring(0, start) + ins + el.value.substring(el.selectionEnd);
                            setTimeout(() => { el.selectionStart = el.selectionEnd = start + ins.length; }, 0);
                        }
                    }
                },
                toggleSubTodo, getCollapsedText, parseContentDetailed
            };
        }
    }).mount('#app');
}

function showErrorPage(msg) {
    document.body.innerHTML = `<div class="p-10 text-center flex flex-col items-center justify-center min-h-screen text-slate-500"><i class="fa-solid fa-circle-exclamation text-4xl text-red-400 mb-4"></i><h2 class="text-xl font-bold">${msg}</h2></div>`;
}

function updatePwaManifest(name, tripId, key, themeId) {
    const link = document.getElementById('manifest-link');
    const meta = document.getElementById('theme-meta');
    if (!link) return;
    const themeColors = { spring: '#e7a8a8', summer: '#6d9bc3', autumn: '#d9a05b', winter: '#8da9c4' };
    const activeColor = themeColors[themeId] || '#e7a8a8';
    if (meta) meta.setAttribute('content', activeColor);
    const manifest = { name: "拾光旅圖", short_name: "拾光旅圖", start_url: `index.html?trip=${tripId}${key ? '&key=' + key : ''}`, display: "standalone", theme_color: activeColor, background_color: "#ffffff", icons: [{ src: "https://rainchord.s3.ap-east-2.amazonaws.com/inventory/1768671480240_travel-bag.png", sizes: "512x512", type: "image/png" }] };
    link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
}

initPlatform();
