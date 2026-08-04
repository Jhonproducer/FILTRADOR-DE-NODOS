const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        const showPoolModal = ref(false);
        const selectedAccountUid = ref(null);
        const showAccountSelectModal = ref(false);
        const nodeToAssign = ref(null);
        
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // --- SISTEMA EVASOR (ANTI FOOTPRINTING) ---
        const lastWorkedIsp = ref('');
        
        const getShortIsp = (fullIsp) => {
            if(!fullIsp) return 'Desconocido';
            const s = fullIsp.toLowerCase();
            if(s.includes('bt ')) return 'BT';
            if(s.includes('sky')) return 'Sky';
            if(s.includes('virgin')) return 'Virgin Media';
            if(s.includes('talktalk')) return 'TalkTalk';
            if(s.includes('vodafone')) return 'Vodafone';
            return fullIsp.split('-')[1]?.trim() || fullIsp;
        };

        const recommendedAccount = computed(() => {
            // Buscamos cuentas que tengan nodo, no choquen y no tengan IP detectada (pendientes)
            const candidates = processedAccounts.value.filter(a => a.nodeId && a.asn_isp && !hasCollision(a));
            if(candidates.length === 0) return null;

            // Intentamos buscar una cuenta que tenga un ISP diferente al último que trabajamos
            const safeCands = candidates.filter(a => getShortIsp(a.asn_isp).toLowerCase() !== lastWorkedIsp.value.toLowerCase());
            
            // Si hay cuentas seguras, agarramos una al azar. Si no, pues la primera que haya.
            const arr = safeCands.length > 0 ? safeCands : candidates;
            return arr[Math.floor(Math.random() * arr.length)];
        });

        const markAsWorked = () => {
            if(recommendedAccount.value) {
                lastWorkedIsp.value = getShortIsp(recommendedAccount.value.asn_isp);
                showStatus(`Marcada. Evitando ${lastWorkedIsp.value} temporalmente.`);
            }
        };

        // --- FILTROS POOL AVANZADOS (Calidad y Top 5) ---
        const filters = ref({ nodeId: '', city: '', isp: '', minQuality: 2.5, onlyTop5: true });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        const clearFilters = () => { filters.value.nodeId = ''; filters.value.city = ''; filters.value.isp = ''; };

        const isTop5ISP = (ispStr) => {
            if (!ispStr) return false;
            const s = ispStr.toLowerCase();
            return s.includes('bt ') || s.includes('sky') || s.includes('virgin') || s.includes('talktalk') || s.includes('vodafone');
        };

        const filteredPool = computed(() => {
            let result = pool.value;
            result = result.filter(n => {
                const inBlacklist = blacklist.value.some(b => b.nodeId === n.id);
                const inUse = accounts.value.some(a => (a.nodeId || '').trim() === n.id);
                return !inBlacklist && !inUse;
            });
            
            // Filtro de Calidad dinámica
            if (filters.value.minQuality) {
                result = result.filter(n => parseFloat(n.q_score) >= parseFloat(filters.value.minQuality));
            }

            // Filtro de Solo Top 5 ISPs
            if (filters.value.onlyTop5) {
                result = result.filter(n => isTop5ISP(n.asn_isp));
            }

            if (filters.value.nodeId) result = result.filter(n => n.id.toLowerCase().includes(filters.value.nodeId.toLowerCase().trim()));
            if (filters.value.city) result = result.filter(n => (n.city || '').toLowerCase().includes(filters.value.city.toLowerCase().trim()));
            if (filters.value.isp) result = result.filter(n => (n.asn_isp || '').toLowerCase().includes(filters.value.isp.toLowerCase().trim()));
            
            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

        // --- CUENTAS ---
        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });

        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) {
                accountSort.value.desc = !accountSort.value.desc;
            } else {
                accountSort.value.field = field;
                accountSort.value.desc = false;
            }
        };

        const processedAccounts = computed(() => {
            let result = accounts.value;
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => 
                    a.name.toLowerCase().includes(s) || 
                    (a.nodeId || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s) ||
                    (a.asn_isp || '').toLowerCase().includes(s)
                );
            }
            if (accountSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[accountSort.value.field] || '';
                    let valB = b[accountSort.value.field] || '';
                    if (accountSort.value.field === 'q_score' || accountSort.value.field === 'fraud_score') {
                        valA = parseFloat(valA) || 0;
                        valB = parseFloat(valB) || 0;
                    }
                    if (valA < valB) return accountSort.value.desc ? 1 : -1;
                    if (valA > valB) return accountSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return result;
        });

        // --- PERSISTENCIA ---
        const saveData = () => {
            localStorage.setItem('vpnerp_acc_master_v13', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_master_v13', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master_v13', JSON.stringify(blacklist.value));
            localStorage.setItem('vpnerp_isp_last', lastWorkedIsp.value);
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_master_v13'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master_v13'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master_v13'));
            lastWorkedIsp.value = localStorage.getItem('vpnerp_isp_last') || '';

            if (!savedAcc || savedAcc.length === 0) {
                const oldKeys = ['v12', 'v11', 'v10', 'master', 'v9'];
                for (let v of oldKeys) {
                    let oldAcc = JSON.parse(localStorage.getItem(`vpnerp_acc_master_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_acc_${v}`));
                    if (oldAcc && oldAcc.length > 0) {
                        savedAcc = oldAcc;
                        savedPool = JSON.parse(localStorage.getItem(`vpnerp_pool_master_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_pool_${v}`));
                        savedBlk = JSON.parse(localStorage.getItem(`vpnerp_blk_master_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_blk_${v}`));
                        break;
                    }
                }
            }

            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc.map(a => ({ 
                    ...a, 
                    uid: a.uid || generateUid(),
                    fraud_score: a.fraud_score !== undefined ? a.fraud_score : null
                }));
            } else {
                const initial = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ uid: generateUid(), name: `LON-${num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', fraud_score: null });
                }
                accounts.value = initial;
            }
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
        };

        watch([accounts, pool, blacklist, lastWorkedIsp], saveData, { deep: true });

        // ==========================================
        // ⚡ AUTO IP + WEB SCRAPER DE SCAMALYTICS
        // ==========================================
        const fetchIpAndScore = async (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(!acc) return;

            syncStatus.value = 'Extrayendo IP...';
            let newIp = null;

            // Extraer IP
            try {
                const r1 = await fetch("https://api.ipify.org?format=json");
                if(r1.ok) { const d1 = await r1.json(); newIp = d1.ip; }
            } catch(e) {
                try {
                    const r2 = await fetch("https://ipinfo.io/json", { headers: { 'Authorization': 'Bearer 8c97cc52a98a48' } });
                    if(r2.ok) { const d2 = await r2.json(); newIp = d2.ip; }
                } catch(e2) {}
            }

            if(!newIp) {
                alert("Bloqueo de red. Imposible leer IP automáticamente.");
                syncStatus.value = '';
                return;
            }

            // Chequeo de colisión
            const collides = accounts.value.some(a => a.uid !== uid && a.ip === newIp);
            if(collides) {
                const proceed = confirm(`⚠️ ALERTA\nLa IP (${newIp}) YA ESTÁ en otra cuenta.\n¿Sobrescribir?`);
                if(!proceed) { syncStatus.value = 'Cancelado.'; return; }
            }

            acc.ip = newIp;
            triggerCollisionCheck(acc);
            
            // --- HACK SCAMALYTICS: WEB SCRAPER VÍA CORS ---
            syncStatus.value = 'Analizando Fraude (Scamalytics)...';
            try {
                // Usamos AllOrigins para burlar el CORS y descargar el HTML crudo de la página de Scamalytics
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://scamalytics.com/ip/${newIp}`)}`;
                const res = await fetch(proxyUrl);
                const data = await res.json();
                
                // Buscamos el texto exacto usando Expresiones Regulares en el HTML
                const htmlString = data.contents;
                const match = htmlString.match(/>Fraud Score:\s*(\d+)/i) || htmlString.match(/"score"\s*:\s*"?(\d+)"?/i);
                
                if (match && match[1]) {
                    acc.fraud_score = parseInt(match[1]);
                    if (acc.fraud_score > 15) {
                        alert(`¡ALERTA DE RIESGO ALTO!\n\nEsta IP (${newIp}) tiene un Score de Fraude de ${acc.fraud_score} en Scamalytics.\n\nSe recomienda DESCARTAR/QUEMAR inmediatamente.`);
                    }
                    syncStatus.value = `¡Score: ${acc.fraud_score}!`;
                } else {
                    acc.fraud_score = null;
                    syncStatus.value = 'IP leída, pero falló extracción de Score.';
                }
            } catch (err) {
                acc.fraud_score = null;
                syncStatus.value = 'IP leída. Falló conexión a Scamalytics.';
            }

            setTimeout(() => { syncStatus.value = ''; }, 4000);
        };

        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };
        const openAccountSelectModal = (node) => { nodeToAssign.value = node; showAccountSelectModal.value = true; };
        const closeAccountSelectModal = () => { showAccountSelectModal.value = false; nodeToAssign.value = null; };
        
        const triggerCollisionCheck = (currentAccount) => {
            if(hasCollision(currentAccount)) {
                alert(`¡ALERTA CRÍTICA!\n\nEl Nodo o IP ingresado YA EXISTE en otra cuenta activa.`);
            }
        };

        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                return (accIp !== '' && curIp !== '' && accIp === curIp) || 
                       (accNode !== '' && curNode !== '' && accNode === curNode);
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountUid.value) {
                const acc = accounts.value.find(a => a.uid === selectedAccountUid.value);
                if (acc) {
                    const nodeData = pool.value.find(n => n.id === nodeId);
                    acc.nodeId = nodeId; acc.ip = ''; acc.fraud_score = null;
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal(); triggerCollisionCheck(acc);
                }
            }
        };

        const confirmAssignFromPool = (accountUid) => {
            const acc = accounts.value.find(a => a.uid === accountUid);
            if (acc && nodeToAssign.value) {
                acc.nodeId = nodeToAssign.value.id;
                acc.ip = ''; acc.fraud_score = null;
                acc.q_score = nodeToAssign.value.q_score;
                acc.asn_isp = nodeToAssign.value.asn_isp;
                closeAccountSelectModal(); triggerCollisionCheck(acc); 
            }
        };

        const burnDirectlyFromPool = (node) => {
            if(node && node.id) {
                if(!blacklist.value.some(b => b.nodeId === node.id)) {
                    blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
                }
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', fraud_score: null });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.fraud_score = null; } };
        
        const burnNode = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc) {
                const nodeStr = (acc.nodeId || '').trim();
                if(nodeStr) {
                    const truncado = nodeStr.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: acc.ip || 'Desconocida' });
                    }
                }
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.fraud_score = null;
            }
        };

        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: 'Carga Masiva' });
                    }
                }
            });
            bulkBlacklistText.value = ''; 
        };
        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };

        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return;
                
                const isBlacklisted = blacklist.value.some(b => b.nodeId === idCorto);
                const isUsed = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                
                if (!isBlacklisted && !isUsed) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        city: nodo.location?.city || 'N/A',
                        asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                        q_score: (nodo.quality?.quality || 0).toFixed(2)
                    });
                }
            });
            pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
            showStatus(`Pool Actualizado: ${pool.value.length} nodos`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
            try {
                // API DIRECTA ORIGINAL (La que pediste, infalible y sin proxies raros)
                const res = await fetch(url, { headers: { 'accept': 'application/json' } });
                if (res.ok) {
                    const data = await res.json();
                    processNodeData(data);
                } else {
                    throw new Error("HTTP " + res.status);
                }
            } catch (e) {
                alert("Error de conexión directa a Mysterium. Sube tu JSON.");
                syncStatus.value = '';
            }
        };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    processNodeData(data); 
                    event.target.value = null; 
                } catch (err) { alert("Error JSON."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text, type = 'Dato') => {
            try { 
                await navigator.clipboard.writeText(text); 
                showStatus(`¡${type} Copiado!`); 
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            } catch (err) { console.error(err); }
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_AntiFootprint_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            showPoolModal, selectedAccountUid, showAccountSelectModal, nodeToAssign,
            collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, 
            filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, 
            addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, 
            openPoolModal, closePoolModal, assignNodeToAccount,
            openAccountSelectModal, closeAccountSelectModal, confirmAssignFromPool, burnDirectlyFromPool,
            fetchIpAndScore, lastWorkedIsp, recommendedAccount, markAsWorked, getShortIsp
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
